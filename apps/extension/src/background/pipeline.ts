import {
  type BrowserEvent,
  type BrowserEventDraft,
  type Clock,
  type IdGenerator,
  type Page,
  type Visit,
  toTimestamp,
} from '@jevtabs/core-domain';
import {
  VisitBuilder,
  createContentPolicy,
  createIngest,
  initialVisitBuilderState,
  type VisitBuilderState,
} from '@jevtabs/capture-engine';
import {
  createCandidateRetriever,
  createHeuristicDecisionProvider,
  createThreadEngine,
} from '@jevtabs/thread-engine';
import { KV_KEYS, readKv, writeKv, type JevTabsDatabase } from '../storage/db.js';
import { createEventLog } from '../storage/event-log.js';
import { createThreadReadModel } from '../storage/read-model.js';
import {
  applyThreadUpdate,
  loadSettings,
  upsertPage,
  upsertVisits,
} from '../storage/repository.js';

/**
 * The capture pipeline: policy → ingest → sessionization → classification.
 *
 * Every step is an injected port, so this whole file runs in Node under test
 * with a fake IndexedDB and no browser at all.
 *
 * Crash safety works in two moves. Events are written durably first and the
 * receipt is proof of that write. Then the fold into Visit state records how
 * far it got (`foldedThrough`), so a worker killed between the two recovers by
 * re-folding the unfolded tail — which is safe because Visit ids are derived
 * from content rather than minted from a clock.
 */

export interface PipelineOptions {
  readonly database: JevTabsDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly captureSessionId: string;
}

interface PersistedFold {
  readonly state: VisitBuilderState;
  /** `occurredAt` of the last event folded in. */
  readonly foldedThrough: string;
}

export interface PipelineResult {
  readonly stored: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly droppedForCapacity: number;
  readonly visitsTouched: number;
  readonly classified: number;
}

const EMPTY_RESULT: PipelineResult = {
  stored: 0,
  duplicates: 0,
  rejected: 0,
  droppedForCapacity: 0,
  visitsTouched: 0,
  classified: 0,
};

export class CapturePipeline {
  private readonly builder = new VisitBuilder();

  constructor(private readonly options: PipelineOptions) {}

  private async loadFold(): Promise<PersistedFold> {
    const stored = await readKv<PersistedFold>(this.options.database, KV_KEYS.visitBuilderState);
    if (stored === null || stored.state?.stateVersion !== initialVisitBuilderState().stateVersion) {
      return { state: initialVisitBuilderState(), foldedThrough: '1970-01-01T00:00:00.000Z' };
    }
    return stored;
  }

  /**
   * Filters drafts through the content policy and records the Page identity
   * for anything that survives. A refused draft leaves no trace anywhere.
   */
  private async screen(drafts: BrowserEventDraft[]): Promise<BrowserEventDraft[]> {
    const settings = await loadSettings(this.options.database, this.options.clock);
    if (!settings.trackingEnabled) return [];
    if (
      settings.pausedUntil !== null &&
      Date.parse(settings.pausedUntil) > this.options.clock.now()
    ) {
      return [];
    }

    const policy = createContentPolicy({
      excludedDomains: settings.excludedDomains,
      keepDocumentQueryParams: settings.keepDocumentQueryParams,
    });

    const kept: BrowserEventDraft[] = [];
    for (const draft of drafts) {
      if (draft.type !== 'navigation_committed') {
        kept.push(draft);
        continue;
      }
      const result = policy.evaluate({ url: draft.url, title: draft.title, incognito: false });
      if (result.decision.outcome === 'reject' || result.normalized === null) continue;

      const page: Page = {
        schemaVersion: 1,
        pageId: draft.pageId,
        url: result.normalized.href,
        host: result.normalized.host,
        rootDomain: result.normalized.rootDomain,
        title: result.title,
        firstSeenAt: draft.occurredAt,
        lastSeenAt: draft.occurredAt,
        trust: 'untrusted_source_content',
      };
      await upsertPage(this.options.database, page);
      kept.push({ ...draft, url: result.normalized.href, title: result.title });
    }
    return kept;
  }

  /** Folds durable events into Visit state and persists both together. */
  private async fold(events: BrowserEvent[]): Promise<Visit[]> {
    if (events.length === 0) return [];
    const ordered = [...events].sort((a, b) =>
      a.occurredAt < b.occurredAt
        ? -1
        : a.occurredAt > b.occurredAt
          ? 1
          : a.eventId < b.eventId
            ? -1
            : 1,
    );
    const previous = await this.loadFold();
    const result = this.builder.applyAll(previous.state, ordered);
    const lastEvent = ordered.at(-1);

    await this.options.database.transaction(
      'rw',
      [this.options.database.visits, this.options.database.kv],
      async () => {
        await upsertVisits(this.options.database, result.visits);
        await writeKv(this.options.database, KV_KEYS.visitBuilderState, {
          state: result.state,
          foldedThrough: lastEvent?.occurredAt ?? previous.foldedThrough,
        } satisfies PersistedFold);
      },
    );

    return result.visits;
  }

  /** Classifies the Visits that are finished and worth classifying. */
  private async classify(visits: Visit[]): Promise<number> {
    const closed = visits.filter((visit) => visit.status === 'closed' && visit.meaningful);
    if (closed.length === 0) return 0;

    const store = createThreadReadModel(this.options.database);
    const engine = createThreadEngine({
      store,
      retriever: createCandidateRetriever({ store, clock: this.options.clock }),
      provider: createHeuristicDecisionProvider(),
      clock: this.options.clock,
      ids: this.options.ids,
      threadCountHint: () => this.threadCount,
    });

    let classified = 0;
    for (const visit of closed) {
      // Already assigned by an earlier run? Replay must not fork a second
      // membership for the same Visit.
      const existing = await this.options.database.memberships
        .where('visitId')
        .equals(visit.visitId)
        .count();
      if (existing > 0) continue;

      const update = await engine.apply(visit);
      await applyThreadUpdate(this.options.database, update);
      if (update.outcome !== 'skipped') classified += 1;
      if (update.outcome === 'created') this.threadCount += 1;
    }
    return classified;
  }

  private threadCount = 0;

  /** The entry point the browser adapter calls with a batch of observations. */
  async handle(drafts: BrowserEventDraft[]): Promise<PipelineResult> {
    if (drafts.length === 0) return EMPTY_RESULT;

    const screened = await this.screen(drafts);
    if (screened.length === 0) return EMPTY_RESULT;

    const log = createEventLog(this.options.database);
    const ingest = createIngest({
      log,
      clock: this.options.clock,
      captureSessionId: this.options.captureSessionId,
    });

    const receipt = await ingest.ingest(screened);
    if (receipt.accepted.length === 0) {
      return {
        ...EMPTY_RESULT,
        duplicates: receipt.duplicates.length,
        rejected: receipt.rejected.length,
        droppedForCapacity: receipt.droppedForCapacity,
      };
    }

    const stored = await this.options.database.events.bulkGet(receipt.accepted);
    const events = stored.filter((event): event is BrowserEvent => event !== undefined);
    const visits = await this.fold(events);
    const classified = await this.classify(visits);

    if (receipt.droppedForCapacity > 0) await this.recordLoss(receipt.droppedForCapacity);

    return {
      stored: receipt.accepted.length,
      duplicates: receipt.duplicates.length,
      rejected: receipt.rejected.length,
      droppedForCapacity: receipt.droppedForCapacity,
      visitsTouched: visits.length,
      classified,
    };
  }

  /**
   * Recovery after a worker restart: re-fold anything the log has but the
   * projection has not seen. Idempotent, so running it needlessly is free.
   */
  async recover(): Promise<PipelineResult> {
    const previous = await this.loadFold();
    const pending = await this.options.database.events
      .where('occurredAt')
      .above(previous.foldedThrough)
      .toArray();
    if (pending.length === 0) return EMPTY_RESULT;

    const visits = await this.fold(pending);
    const classified = await this.classify(visits);
    return { ...EMPTY_RESULT, visitsTouched: visits.length, classified };
  }

  /** Closes every open Visit — on shutdown, or when tracking is turned off. */
  async flush(): Promise<Visit[]> {
    const previous = await this.loadFold();
    const at = toTimestamp(this.options.clock.now());
    const result = this.builder.flush(previous.state, at);
    if (result.visits.length === 0) return [];

    await this.options.database.transaction(
      'rw',
      [this.options.database.visits, this.options.database.kv],
      async () => {
        await upsertVisits(this.options.database, result.visits);
        await writeKv(this.options.database, KV_KEYS.visitBuilderState, {
          state: result.state,
          foldedThrough: previous.foldedThrough,
        } satisfies PersistedFold);
      },
    );
    await this.classify(result.visits);
    return result.visits;
  }

  /**
   * Bounded-outbox loss is surfaced, never swallowed: the workspace shows a
   * count so the person knows some low-value signals were not recorded.
   */
  private async recordLoss(count: number): Promise<void> {
    const current = (await readKv<number>(this.options.database, KV_KEYS.lossCounter)) ?? 0;
    await writeKv(this.options.database, KV_KEYS.lossCounter, current + count);
  }
}
