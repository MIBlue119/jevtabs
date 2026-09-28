import type { Page, Thread, Visit } from '@jevtabs/core-domain';

/**
 * The read surface the Thread engine needs. Implemented by the extension's
 * Dexie adapter today and by the SQLite companion later; the engine itself
 * never learns which.
 */

export interface ThreadProfile {
  readonly thread: Thread;
  /** One-line description shown to a decision provider and in review UI. */
  readonly summary: string;
  /** Pages a human has explicitly confirmed into this Thread. */
  readonly confirmedPageIds: readonly string[];
  /** Hosts seen in this Thread, with how often. Cheap domain affinity signal. */
  readonly hostCounts: Readonly<Record<string, number>>;
}

export interface ThreadReadModel {
  /** Threads worth considering: active, dormant, or paused — never archived. */
  candidateThreads(options: { readonly limit: number }): Promise<ThreadProfile[]>;
  page(pageId: string): Promise<Page | null>;
  /** Threads this exact page already belongs to, via any prior Visit. */
  threadIdsForPage(pageId: string): Promise<string[]>;
  visit(visitId: string): Promise<Visit | null>;
}
