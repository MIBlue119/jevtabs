import Dexie, { type EntityTable } from 'dexie';
import type {
  Artifact,
  BrowserEvent,
  Checkpoint,
  Evidence,
  Finding,
  Page,
  ReviewItem,
  Thread,
  ThreadMembership,
  Tombstone,
  Visit,
} from '@jevtabs/core-domain';

/**
 * Local storage.
 *
 * IndexedDB via Dexie is the Phase 1 store; the SQLite companion replaces it
 * later without the domain noticing, because everything above this file speaks
 * the ports in `@jevtabs/core-domain`.
 *
 * Two shapes here are load-bearing:
 *
 *   - `events` is append-only and keyed by `eventId`, so replaying a batch
 *     after a service-worker restart is a no-op rather than a duplicate.
 *   - `kv` holds the sessionization state. It is written in the same
 *     transaction as the events that produced it, so the two can never
 *     disagree about what has already been folded in.
 */

export interface KvRow {
  key: string;
  value: unknown;
}

export class JevTabsDatabase extends Dexie {
  events!: EntityTable<BrowserEvent, 'eventId'>;
  pages!: EntityTable<Page, 'pageId'>;
  visits!: EntityTable<Visit, 'visitId'>;
  threads!: EntityTable<Thread, 'threadId'>;
  memberships!: EntityTable<ThreadMembership, 'membershipId'>;
  evidence!: EntityTable<Evidence, 'evidenceId'>;
  findings!: EntityTable<Finding, 'findingId'>;
  checkpoints!: EntityTable<Checkpoint, 'checkpointId'>;
  reviews!: EntityTable<ReviewItem, 'reviewId'>;
  artifacts!: EntityTable<Artifact, 'artifactId'>;
  tombstones!: EntityTable<Tombstone, 'tombstoneId'>;
  kv!: EntityTable<KvRow, 'key'>;

  constructor(name = 'jevtabs') {
    super(name);
    this.version(1).stores({
      events: 'eventId, occurredAt, type, captureSessionId',
      pages: 'pageId, host, rootDomain, lastSeenAt',
      visits: 'visitId, pageId, startedAt, status, meaningful, tabKey',
      threads: 'threadId, status, lastActivityAt, updatedAt',
      memberships: 'membershipId, visitId, threadId, state, [visitId+revision]',
      evidence: 'evidenceId, threadId, pageId, capturedAt',
      findings: 'findingId, threadId, state, updatedAt',
      checkpoints: 'checkpointId, threadId, createdAt',
      reviews: 'reviewId, status, createdAt, kind',
      artifacts: 'artifactId, threadId, state',
      tombstones: 'tombstoneId, entity, deletedAt',
      kv: 'key',
    });
  }
}

let instance: JevTabsDatabase | null = null;

/** One connection per context. Extension pages and the worker each get their own. */
export function db(): JevTabsDatabase {
  instance ??= new JevTabsDatabase();
  return instance;
}

/** Test seam: point the helpers at a throwaway database. */
export function setDatabase(next: JevTabsDatabase | null): void {
  instance = next;
}

export const KV_KEYS = {
  settings: 'settings',
  visitBuilderState: 'visit-builder-state',
  captureSession: 'capture-session',
  lastEventAt: 'last-event-at',
  lossCounter: 'loss-counter',
} as const;

export async function readKv<T>(database: JevTabsDatabase, key: string): Promise<T | null> {
  const row = await database.kv.get(key);
  return row === undefined ? null : (row.value as T);
}

export async function writeKv(
  database: JevTabsDatabase,
  key: string,
  value: unknown,
): Promise<void> {
  await database.kv.put({ key, value });
}
