import {
  type BrowserEvent,
  type BrowserEventDraft,
  type Clock,
  type EventLog,
  type IdGenerator,
  type IngestReceipt,
  browserEventSchema,
  toTimestamp,
} from '@jevtabs/core-domain';

/**
 * The ingest boundary.
 *
 * Every event is stamped, validated against the wire contract, and written to
 * the durable log *before* this call resolves. Callers may only treat an event
 * as captured once they hold the receipt — an acknowledgement that outruns the
 * write is indistinguishable from data loss when the service worker dies.
 */

export interface IngestOptions {
  readonly log: EventLog;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Stable for the life of a browser session; survives worker termination. */
  readonly captureSessionId: string;
  /**
   * Bounded queue size. If a batch would exceed it, the lowest-value events
   * (coarse interactions) are dropped first and the loss is reported rather
   * than hidden.
   */
  readonly maxBatch?: number;
}

const LOW_VALUE_TYPES = new Set<BrowserEvent['type']>(['interaction']);

export function createIngest(options: IngestOptions): {
  ingest(drafts: BrowserEventDraft[]): Promise<IngestReceipt>;
} {
  const maxBatch = options.maxBatch ?? 500;

  return {
    async ingest(drafts) {
      if (drafts.length === 0) {
        return { accepted: [], duplicates: [], rejected: [], droppedForCapacity: 0 };
      }

      let candidates = drafts;
      let droppedForCapacity = 0;
      if (candidates.length > maxBatch) {
        const highValue = candidates.filter((draft) => !LOW_VALUE_TYPES.has(draft.type));
        const lowValue = candidates.filter((draft) => LOW_VALUE_TYPES.has(draft.type));
        const room = Math.max(0, maxBatch - highValue.length);
        droppedForCapacity = lowValue.length - Math.min(room, lowValue.length);
        candidates = [...highValue, ...lowValue.slice(0, room)].slice(0, maxBatch);
      }

      const recordedAt = toTimestamp(options.clock.now());
      const valid: BrowserEvent[] = [];
      const rejected: IngestReceipt['rejected'] = [];

      for (const draft of candidates) {
        const eventId = options.ids.next();
        const parsed = browserEventSchema.safeParse({
          ...draft,
          schemaVersion: 1,
          eventId,
          recordedAt,
          captureSessionId: options.captureSessionId,
        });
        if (parsed.success) {
          valid.push(parsed.data);
        } else {
          // The message names the failing field, never its value.
          rejected.push({
            eventId,
            reason: parsed.error.issues.map((issue) => issue.path.join('.') || '<root>').join(','),
          });
        }
      }

      const receipt = await options.log.append(valid);
      return {
        accepted: receipt.accepted,
        duplicates: receipt.duplicates,
        rejected: [...rejected, ...receipt.rejected],
        droppedForCapacity: droppedForCapacity + receipt.droppedForCapacity,
      };
    },
  };
}
