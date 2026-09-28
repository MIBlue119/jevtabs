import {
  type BrowserEvent,
  type BrowserEventDraft,
  type Clock,
  type EventLog,
  type IngestReceipt,
  browserEventSchema,
  deterministicUuid,
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

/**
 * An event's identity is the observation itself, not the moment we happened to
 * mint an id for it.
 *
 * This is what makes replay idempotent in the way the architecture requires.
 * The browser adapter can redeliver a burst after the service worker is
 * restarted mid-drain, and the log recognizes the redelivered observations as
 * the ones it already holds instead of writing a second copy. A clock-derived
 * id could not do that: it would describe when we reacted, which is precisely
 * the thing that differs between the original delivery and the retry.
 *
 * Two observations that agree on every field — same tab, same page, same
 * millisecond, same capture session — are the same observation, and collapsing
 * them is correct rather than lossy.
 */
function eventIdFor(draft: BrowserEventDraft, captureSessionId: string): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(draft).sort(([a], [b]) => (a < b ? -1 : 1))),
  );
  return deterministicUuid('event', `${captureSessionId}|${canonical}`);
}

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
        const eventId = eventIdFor(draft, options.captureSessionId);
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
