import {
  type Checkpoint,
  type Clock,
  type Evidence,
  type Finding,
  type IdGenerator,
  type Page,
  type ReviewItem,
  type Settings,
  type Thread,
  type ThreadMembership,
  type ThreadUpdate,
  type Visit,
  DAY_MS,
  defaultSettings,
  fromTimestamp,
  settingsSchema,
  toTimestamp,
} from '@jevtabs/core-domain';
import {
  confirmMembership,
  correctMembership,
  currentMembership,
  evidenceIdFor,
} from '@jevtabs/thread-engine';
import { KV_KEYS, readKv, writeKv, type JevTabsDatabase } from './db.js';

/**
 * Every write the product performs.
 *
 * Two rules the transactions here exist to enforce:
 *
 *   - An assignment is all-or-nothing. A service worker terminated mid-write
 *     must leave either the Thread, membership, and Evidence all present, or
 *     none of them — a Thread with no Evidence is worse than no Thread.
 *   - Human decisions append. A correction never edits the row it replaces; it
 *     marks it superseded and writes a new revision beside it.
 */

export interface RepositoryContext {
  readonly database: JevTabsDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function loadSettings(database: JevTabsDatabase, clock: Clock): Promise<Settings> {
  const stored = await readKv<unknown>(database, KV_KEYS.settings);
  const parsed = settingsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  // An unreadable settings row falls back to the strict defaults rather than
  // to whatever happens to be in memory.
  const fresh = defaultSettings(toTimestamp(clock.now()));
  await writeKv(database, KV_KEYS.settings, fresh);
  return fresh;
}

export async function saveSettings(
  database: JevTabsDatabase,
  clock: Clock,
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await loadSettings(database, clock);
  const next = settingsSchema.parse({
    ...current,
    ...patch,
    updatedAt: toTimestamp(clock.now()),
  });
  await writeKv(database, KV_KEYS.settings, next);
  return next;
}

/** Upserts the Page identity, keeping the first-seen timestamp stable. */
export async function upsertPage(database: JevTabsDatabase, page: Page): Promise<void> {
  const existing = await database.pages.get(page.pageId);
  await database.pages.put(
    existing === undefined
      ? page
      : {
          ...existing,
          title: page.title,
          lastSeenAt:
            fromTimestamp(page.lastSeenAt) > fromTimestamp(existing.lastSeenAt)
              ? page.lastSeenAt
              : existing.lastSeenAt,
        },
  );
}

/** Writes a batch of Visit snapshots. Keyed by id, so replay converges. */
export async function upsertVisits(database: JevTabsDatabase, visits: Visit[]): Promise<void> {
  if (visits.length === 0) return;
  await database.visits.bulkPut(visits);
}

export async function applyThreadUpdate(
  database: JevTabsDatabase,
  update: ThreadUpdate,
): Promise<void> {
  if (update.outcome === 'skipped' || update.outcome === 'noise') return;

  await database.transaction(
    'rw',
    [database.threads, database.memberships, database.evidence, database.reviews],
    async () => {
      if (update.thread !== null) await database.threads.put(update.thread);
      if (update.membership !== null) await database.memberships.put(update.membership);
      if (update.evidence !== null) await database.evidence.put(update.evidence);
      if (update.review !== null) await database.reviews.put(update.review);
    },
  );
}

export async function membershipsFor(
  database: JevTabsDatabase,
  visitId: string,
): Promise<ThreadMembership[]> {
  return database.memberships.where('visitId').equals(visitId).toArray();
}

/**
 * Resolves a review item the way the person chose. `threadId === null` means
 * "this visit was not work" — the Visit stays, the assignment does not.
 */
export async function resolveClassification(
  context: RepositoryContext,
  reviewId: string,
  threadId: string | null,
): Promise<void> {
  const { database } = context;
  const review = await database.reviews.get(reviewId);
  if (review === undefined || review.kind !== 'classification') return;

  const history = await membershipsFor(database, review.visitId);
  const current = currentMembership(history);
  const visit = await database.visits.get(review.visitId);
  const page = visit === undefined ? undefined : await database.pages.get(visit.pageId);

  await database.transaction(
    'rw',
    [database.reviews, database.memberships, database.threads, database.evidence],
    async () => {
      if (threadId !== null) {
        const result = correctMembership(context, current, review.visitId, threadId);
        if (result.previous !== null) await database.memberships.put(result.previous);
        if (result.next !== null) await database.memberships.put(result.next);

        const thread = await database.threads.get(threadId);
        if (thread !== undefined) {
          await database.threads.put({
            ...thread,
            status: thread.status === 'dormant' ? 'active' : thread.status,
            confirmed: true,
            updatedAt: toTimestamp(context.clock.now()),
            lastActivityAt: visit?.endedAt ?? thread.lastActivityAt,
          });
        }

        if (visit !== undefined && page !== undefined) {
          const already = await database.evidence
            .where('threadId')
            .equals(threadId)
            .filter((row) => row.visitId === visit.visitId)
            .first();
          if (already === undefined) {
            const evidence: Evidence = {
              schemaVersion: 1,
              evidenceId: evidenceIdFor(threadId, visit.visitId),
              threadId,
              visitId: visit.visitId,
              pageId: page.pageId,
              title: page.title,
              url: page.url,
              role: 'reference',
              excerpt: null,
              capturedAt: toTimestamp(context.clock.now()),
            };
            await database.evidence.put(evidence);
          }
        }
      } else if (current !== null) {
        await database.memberships.put({ ...current, state: 'withdrawn', decidedBy: 'human' });
      }

      await database.reviews.put({
        ...review,
        status: 'resolved',
        resolvedAt: toTimestamp(context.clock.now()),
      });
    },
  );
}

export async function dismissReview(context: RepositoryContext, reviewId: string): Promise<void> {
  const review = await context.database.reviews.get(reviewId);
  if (review === undefined) return;
  await context.database.reviews.put({
    ...review,
    status: 'dismissed',
    resolvedAt: toTimestamp(context.clock.now()),
  });
}

/** Accepts the classifier's own suggestion for every open, unambiguous item. */
export async function acceptHighConfidence(
  context: RepositoryContext,
  minimumConfidence: number,
): Promise<number> {
  const open = await context.database.reviews.where('status').equals('open').toArray();
  let resolved = 0;
  for (const review of open) {
    if (review.kind !== 'classification') continue;
    if (review.suggestedThreadId === null || review.confidence < minimumConfidence) continue;
    await resolveClassification(context, review.reviewId, review.suggestedThreadId);
    resolved += 1;
  }
  return resolved;
}

export async function confirmThread(context: RepositoryContext, threadId: string): Promise<void> {
  const thread = await context.database.threads.get(threadId);
  if (thread === undefined) return;
  await context.database.threads.put({
    ...thread,
    confirmed: true,
    updatedAt: toTimestamp(context.clock.now()),
  });

  const memberships = await context.database.memberships
    .where('threadId')
    .equals(threadId)
    .toArray();
  for (const membership of memberships) {
    if (membership.state !== 'proposed') continue;
    const result = confirmMembership(context, membership);
    if (result.next !== null) await context.database.memberships.put(result.next);
  }
}

export async function updateThread(
  context: RepositoryContext,
  threadId: string,
  patch: Partial<Pick<Thread, 'title' | 'intent' | 'status' | 'accent'>>,
): Promise<void> {
  const thread = await context.database.threads.get(threadId);
  if (thread === undefined) return;
  await context.database.threads.put({
    ...thread,
    ...patch,
    updatedAt: toTimestamp(context.clock.now()),
  });
}

export async function addFinding(
  context: RepositoryContext,
  threadId: string,
  text: string,
  detail = '',
  sourceRefs: string[] = [],
): Promise<Finding> {
  const now = toTimestamp(context.clock.now());
  const finding: Finding = {
    schemaVersion: 1,
    findingId: context.ids.next(),
    threadId,
    revision: 1,
    text,
    detail,
    provenance: 'human',
    state: 'confirmed',
    sourceRefs,
    confidence: null,
    createdAt: now,
    updatedAt: now,
    author: 'you',
    supersedesId: null,
  };
  await context.database.findings.put(finding);
  return finding;
}

export async function setFindingState(
  context: RepositoryContext,
  findingId: string,
  state: Finding['state'],
): Promise<void> {
  const finding = await context.database.findings.get(findingId);
  if (finding === undefined) return;
  // A human decision on a proposal is recorded as a new revision; the proposal
  // itself is kept so it stays possible to audit what an agent suggested.
  await context.database.findings.put({
    ...finding,
    state,
    revision: finding.revision + 1,
    updatedAt: toTimestamp(context.clock.now()),
    author: 'you',
  });
}

export async function createCheckpoint(
  context: RepositoryContext,
  input: {
    threadId: string;
    title: string;
    nextAction: string;
    openQuestions: string[];
    pauseThread: boolean;
  },
): Promise<Checkpoint> {
  const { database } = context;
  const now = toTimestamp(context.clock.now());
  const thread = await database.threads.get(input.threadId);
  const evidence = await database.evidence.where('threadId').equals(input.threadId).toArray();
  const findings = await database.findings.where('threadId').equals(input.threadId).toArray();

  const checkpoint: Checkpoint = {
    schemaVersion: 1,
    checkpointId: context.ids.next(),
    threadId: input.threadId,
    title: input.title,
    intent: thread?.intent ?? '',
    keySources: evidence.slice(0, 32).map((row) => row.evidenceId),
    settledFindings: findings
      .filter((finding) => finding.state === 'confirmed')
      .slice(0, 32)
      .map((finding) => finding.findingId),
    openQuestions: input.openQuestions.filter((question) => question.trim() !== '').slice(0, 16),
    nextAction: input.nextAction,
    createdAt: now,
    pausedThread: input.pauseThread,
  };

  await database.transaction('rw', [database.checkpoints, database.threads], async () => {
    await database.checkpoints.put(checkpoint);
    if (thread !== undefined) {
      await database.threads.put({
        ...thread,
        status: input.pauseThread ? 'paused' : thread.status,
        updatedAt: now,
      });
    }
  });

  return checkpoint;
}

/**
 * Deletion removes the searchable content immediately and leaves a tombstone.
 * The tombstone records that something was deleted, never what it said.
 */
export async function deleteThread(context: RepositoryContext, threadId: string): Promise<void> {
  const { database } = context;
  const now = toTimestamp(context.clock.now());
  await database.transaction(
    'rw',
    [
      database.threads,
      database.memberships,
      database.evidence,
      database.findings,
      database.checkpoints,
      database.reviews,
      database.tombstones,
    ],
    async () => {
      await database.evidence.where('threadId').equals(threadId).delete();
      await database.findings.where('threadId').equals(threadId).delete();
      await database.checkpoints.where('threadId').equals(threadId).delete();
      await database.memberships.where('threadId').equals(threadId).delete();
      await database.threads.delete(threadId);
      await database.tombstones.put({
        schemaVersion: 1,
        tombstoneId: context.ids.next(),
        entity: 'thread',
        entityId: threadId,
        deletedAt: now,
        reason: 'user',
      });
    },
  );
}

/** Removes everything ever recorded for a host. Used by "exclude this domain". */
export async function purgeDomain(context: RepositoryContext, host: string): Promise<number> {
  const { database } = context;
  const pages = await database.pages
    .filter((page) => page.host === host || page.host.endsWith(`.${host}`))
    .toArray();
  const pageIds = new Set(pages.map((page) => page.pageId));
  if (pageIds.size === 0) return 0;

  const visits = await database.visits.filter((visit) => pageIds.has(visit.pageId)).toArray();
  const visitIds = new Set(visits.map((visit) => visit.visitId));

  await database.transaction(
    'rw',
    [
      database.pages,
      database.visits,
      database.events,
      database.evidence,
      database.memberships,
      database.reviews,
      database.tombstones,
    ],
    async () => {
      await database.evidence.filter((row) => pageIds.has(row.pageId)).delete();
      await database.memberships.filter((row) => visitIds.has(row.visitId)).delete();
      await database.reviews
        .filter((row) => row.kind !== 'agent_proposal' && visitIds.has(row.visitId))
        .delete();
      await database.events
        .filter((event) => 'pageId' in event && event.pageId !== null && pageIds.has(event.pageId))
        .delete();
      await database.visits.filter((visit) => visitIds.has(visit.visitId)).delete();
      await database.pages.filter((page) => pageIds.has(page.pageId)).delete();
      await database.tombstones.put({
        schemaVersion: 1,
        tombstoneId: context.ids.next(),
        entity: 'page',
        entityId: host,
        deletedAt: toTimestamp(context.clock.now()),
        reason: 'exclusion',
      });
    },
  );
  return pageIds.size;
}

/**
 * Retention sweep. Raw events and Visits that never became work expire;
 * anything a human confirmed is kept until they delete it.
 */
export async function applyRetention(context: RepositoryContext): Promise<{
  events: number;
  visits: number;
}> {
  const { database } = context;
  const settings = await loadSettings(database, context.clock);
  const now = context.clock.now();

  const eventCutoff = toTimestamp(now - settings.retention.rawEventDays * DAY_MS);
  const events = await database.events.where('occurredAt').below(eventCutoff).delete();

  const visitCutoff = toTimestamp(now - settings.retention.unpromotedVisitDays * DAY_MS);
  const stale = await database.visits.where('startedAt').below(visitCutoff).toArray();
  const promoted = new Set((await database.evidence.toArray()).map((row) => row.visitId));
  const removable = stale.filter(
    (visit) => !promoted.has(visit.visitId) && visit.status === 'closed',
  );
  if (removable.length > 0) {
    await database.visits.bulkDelete(removable.map((visit) => visit.visitId));
  }

  return { events, visits: removable.length };
}

/** Marks Threads dormant once they have been quiet for longer than the policy. */
export async function refreshDormancy(context: RepositoryContext): Promise<number> {
  const { database } = context;
  const settings = await loadSettings(database, context.clock);
  const cutoff = toTimestamp(context.clock.now() - settings.visitPolicy.dormantAfterMs);
  const stale = await database.threads
    .where('status')
    .equals('active')
    .filter((thread) => thread.lastActivityAt < cutoff)
    .toArray();

  for (const thread of stale) {
    await database.threads.put({ ...thread, status: 'dormant' });
  }
  return stale.length;
}

export async function openReviewCount(database: JevTabsDatabase): Promise<number> {
  return database.reviews.where('status').equals('open').count();
}

export async function createManualThread(
  context: RepositoryContext,
  title: string,
): Promise<Thread> {
  const now = toTimestamp(context.clock.now());
  const thread: Thread = {
    schemaVersion: 1,
    threadId: context.ids.next(),
    title,
    intent: '',
    status: 'active',
    accent: 'blue',
    keywords: [],
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    origin: 'human',
    confirmed: true,
  };
  await context.database.threads.put(thread);
  return thread;
}

export type { ReviewItem };
