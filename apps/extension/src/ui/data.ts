import {
  createIdGenerator,
  systemClock,
  type Evidence,
  type Page,
  type ReviewItem,
  type Thread,
  type ThreadMembership,
  type Visit,
} from '@jevtabs/core-domain';
import { db } from '../storage/db.js';
import type { RepositoryContext } from '../storage/repository.js';

/**
 * The UI reads and writes the same IndexedDB the worker does.
 *
 * Extension pages share an origin with the service worker, so there is no RPC
 * layer here on purpose: an extra message hop would buy nothing and would put
 * a serialization boundary between the workspace and its own data. Dexie's
 * live queries then make every surface — popup, side panel, workspace —
 * update together without any explicit invalidation.
 */

export function uiContext(): RepositoryContext {
  const clock = systemClock;
  return { database: db(), clock, ids: createIdGenerator(clock) };
}

export interface ThreadOverview {
  readonly thread: Thread;
  readonly sourceCount: number;
  readonly checkpointCount: number;
  readonly lastEvidence: Evidence | null;
  readonly confidence: number | null;
}

export async function threadOverviews(statuses?: Thread['status'][]): Promise<ThreadOverview[]> {
  const database = db();
  const threads = await database.threads.toArray();
  const filtered =
    statuses === undefined ? threads : threads.filter((thread) => statuses.includes(thread.status));

  const out: ThreadOverview[] = [];
  for (const thread of filtered) {
    const evidence = await database.evidence.where('threadId').equals(thread.threadId).toArray();
    const checkpointCount = await database.checkpoints
      .where('threadId')
      .equals(thread.threadId)
      .count();
    const memberships = await database.memberships
      .where('threadId')
      .equals(thread.threadId)
      .toArray();
    const live = memberships.filter((row) => row.state === 'proposed' || row.state === 'confirmed');
    const confidence =
      live.length === 0 ? null : live.reduce((sum, row) => sum + row.confidence, 0) / live.length;

    out.push({
      thread,
      sourceCount: new Set(evidence.map((row) => row.pageId)).size,
      checkpointCount,
      lastEvidence: evidence.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0] ?? null,
      confidence,
    });
  }

  return out.sort((a, b) => (a.thread.lastActivityAt < b.thread.lastActivityAt ? 1 : -1));
}

export interface TimelineEntry {
  readonly visit: Visit;
  readonly page: Page;
  readonly membership: ThreadMembership | null;
  readonly thread: Thread | null;
}

/** Meaningful Visits since `sinceMs`, newest first, with their assignment. */
export async function recentTimeline(sinceMs: number, limit = 40): Promise<TimelineEntry[]> {
  const database = db();
  const since = new Date(sinceMs).toISOString();
  const visits = await database.visits
    .where('startedAt')
    .above(since)
    .filter((visit) => visit.meaningful)
    .toArray();

  const entries: TimelineEntry[] = [];
  for (const visit of visits.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit)) {
    const page = await database.pages.get(visit.pageId);
    if (page === undefined) continue;
    const memberships = await database.memberships.where('visitId').equals(visit.visitId).toArray();
    const live = memberships
      .filter((row) => row.state === 'proposed' || row.state === 'confirmed')
      .sort((a, b) => b.revision - a.revision)[0];
    const thread = live === undefined ? undefined : await database.threads.get(live.threadId);
    entries.push({ visit, page, membership: live ?? null, thread: thread ?? null });
  }
  return entries;
}

export interface InboxEntry {
  readonly review: Extract<ReviewItem, { kind: 'classification' }>;
  readonly visit: Visit | null;
  readonly page: Page | null;
}

export async function openInbox(): Promise<InboxEntry[]> {
  const database = db();
  const reviews = await database.reviews.where('status').equals('open').toArray();
  const out: InboxEntry[] = [];
  for (const review of reviews) {
    if (review.kind !== 'classification') continue;
    const visit = (await database.visits.get(review.visitId)) ?? null;
    const page = visit === null ? null : ((await database.pages.get(visit.pageId)) ?? null);
    out.push({ review, visit, page });
  }
  return out.sort((a, b) => (a.review.createdAt < b.review.createdAt ? 1 : -1));
}

export interface ThreadDetail {
  readonly thread: Thread;
  readonly evidence: Evidence[];
  readonly findings: Awaited<ReturnType<typeof loadFindings>>;
  readonly checkpoints: Awaited<ReturnType<typeof loadCheckpoints>>;
  readonly visits: TimelineEntry[];
}

async function loadFindings(threadId: string) {
  return db().findings.where('threadId').equals(threadId).toArray();
}

async function loadCheckpoints(threadId: string) {
  const rows = await db().checkpoints.where('threadId').equals(threadId).toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function threadDetail(threadId: string): Promise<ThreadDetail | null> {
  const database = db();
  const thread = await database.threads.get(threadId);
  if (thread === undefined) return null;

  const evidence = (await database.evidence.where('threadId').equals(threadId).toArray()).sort(
    (a, b) => (a.capturedAt < b.capturedAt ? 1 : -1),
  );

  const visits: TimelineEntry[] = [];
  for (const row of evidence) {
    const visit = await database.visits.get(row.visitId);
    const page = await database.pages.get(row.pageId);
    if (visit === undefined || page === undefined) continue;
    visits.push({ visit, page, membership: null, thread });
  }

  return {
    thread,
    evidence,
    findings: await loadFindings(threadId),
    checkpoints: await loadCheckpoints(threadId),
    visits,
  };
}

/** Counts used by the popup and the side panel. */
export async function quickStats(): Promise<{
  openReviews: number;
  activeThreads: number;
  visitsToday: number;
  droppedSignals: number;
}> {
  const database = db();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [openReviews, activeThreads, visits, loss] = await Promise.all([
    database.reviews.where('status').equals('open').count(),
    database.threads.where('status').equals('active').count(),
    database.visits
      .where('startedAt')
      .above(startOfDay.toISOString())
      .filter((visit) => visit.meaningful)
      .count(),
    database.kv.get('loss-counter'),
  ]);

  return {
    openReviews,
    activeThreads,
    visitsToday: visits,
    droppedSignals: typeof loss?.value === 'number' ? loss.value : 0,
  };
}

export function relativeTime(timestamp: string, nowMs = Date.now()): string {
  const deltaMs = nowMs - Date.parse(timestamp);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return '剛剛 · just now';
  if (minutes < 60) return `${minutes} 分鐘前 · ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前 · ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前 · ${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
