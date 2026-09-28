import type { BrowserEvent, EventLog, IngestReceipt } from '@jevtabs/core-domain';
import type { JevTabsDatabase } from './db.js';

/**
 * The durable event log.
 *
 * `append` resolves only after the write has committed, because the ingest
 * boundary treats the receipt as proof of persistence. Writes use `add` inside
 * one transaction so a replayed `eventId` is reported as a duplicate rather
 * than silently overwriting — replay must be a no-op, not an update.
 */
export function createEventLog(database: JevTabsDatabase): EventLog {
  return {
    async append(events: BrowserEvent[]): Promise<IngestReceipt> {
      const accepted: string[] = [];
      const duplicates: string[] = [];
      if (events.length === 0) {
        return { accepted, duplicates, rejected: [], droppedForCapacity: 0 };
      }

      await database.transaction('rw', database.events, async () => {
        const ids = events.map((event) => event.eventId);
        const existing = await database.events.where('eventId').anyOf(ids).primaryKeys();
        const known = new Set(existing);
        const fresh = events.filter((event) => {
          if (known.has(event.eventId)) {
            duplicates.push(event.eventId);
            return false;
          }
          accepted.push(event.eventId);
          return true;
        });
        if (fresh.length > 0) await database.events.bulkAdd(fresh);
      });

      return { accepted, duplicates, rejected: [], droppedForCapacity: 0 };
    },

    async since(timestamp: string, limit: number): Promise<BrowserEvent[]> {
      return database.events.where('occurredAt').above(timestamp).limit(limit).toArray();
    },

    async purgeBefore(timestamp: string): Promise<number> {
      return database.events.where('occurredAt').below(timestamp).delete();
    },
  };
}
