import { describe, expect, it } from 'vitest';
import type { BrowserEvent, BrowserEventDraft, EventLog } from '@jevtabs/core-domain';
import { createIngest } from '@jevtabs/capture-engine';
import { createHarness } from '@jevtabs/test-fixtures';

/** An in-memory log that records whether the write happened before the ack. */
function memoryLog(): EventLog & { rows: Map<string, BrowserEvent>; writes: number } {
  const rows = new Map<string, BrowserEvent>();
  const log = {
    rows,
    writes: 0,
    async append(events: BrowserEvent[]) {
      log.writes += 1;
      const accepted: string[] = [];
      const duplicates: string[] = [];
      for (const event of events) {
        if (rows.has(event.eventId)) duplicates.push(event.eventId);
        else {
          rows.set(event.eventId, event);
          accepted.push(event.eventId);
        }
      }
      return { accepted, duplicates, rejected: [], droppedForCapacity: 0 };
    },
    async since() {
      return [...rows.values()];
    },
    async purgeBefore() {
      return 0;
    },
  };
  return log;
}

const navigation: BrowserEventDraft = {
  type: 'navigation_committed',
  occurredAt: '2026-09-18T09:12:00.000Z',
  tabKey: '1:1',
  pageId: 'a'.repeat(32),
  url: 'https://example.com/docs',
  title: 'Docs',
  cause: 'typed',
  referrerPageId: null,
};

describe('ingest boundary', () => {
  it('writes to the durable log before the receipt resolves', async () => {
    const harness = createHarness();
    const log = memoryLog();
    const ingest = createIngest({ log, clock: harness.clock, ids: harness.ids, captureSessionId: harness.captureSessionId });

    const receipt = await ingest.ingest([navigation]);
    expect(log.rows.size).toBe(1);
    expect(receipt.accepted).toHaveLength(1);
    expect(receipt.rejected).toEqual([]);
  });

  it('stamps every event with schema version, ids, and the capture session', async () => {
    const harness = createHarness();
    const log = memoryLog();
    const ingest = createIngest({ log, clock: harness.clock, ids: harness.ids, captureSessionId: harness.captureSessionId });

    await ingest.ingest([navigation]);
    const [stored] = [...log.rows.values()];
    expect(stored?.schemaVersion).toBe(1);
    expect(stored?.captureSessionId).toBe(harness.captureSessionId);
    expect(stored?.recordedAt).toBeDefined();
  });

  it('rejects an event that violates the wire contract without naming its value', async () => {
    const harness = createHarness();
    const log = memoryLog();
    const ingest = createIngest({ log, clock: harness.clock, ids: harness.ids, captureSessionId: harness.captureSessionId });

    const receipt = await ingest.ingest([
      { ...navigation, url: 'not-a-url' } as BrowserEventDraft,
    ]);
    expect(receipt.accepted).toEqual([]);
    expect(receipt.rejected).toHaveLength(1);
    expect(receipt.rejected[0]?.reason).toBe('url');
    expect(JSON.stringify(receipt)).not.toContain('not-a-url');
    expect(log.rows.size).toBe(0);
  });

  it('drops low-value interactions first when the batch exceeds capacity, and says so', async () => {
    const harness = createHarness();
    const log = memoryLog();
    const ingest = createIngest({
      log,
      clock: harness.clock,
      ids: harness.ids,
      captureSessionId: harness.captureSessionId,
      maxBatch: 3,
    });

    const interactions: BrowserEventDraft[] = Array.from({ length: 6 }, () => ({
      type: 'interaction',
      occurredAt: '2026-09-18T09:12:01.000Z',
      tabKey: '1:1',
      pageId: 'a'.repeat(32),
      kind: 'scroll',
    }));

    const receipt = await ingest.ingest([navigation, navigation, ...interactions]);
    expect(receipt.droppedForCapacity).toBe(5);
    expect(receipt.accepted).toHaveLength(3);
  });

  it('treats an empty batch as a no-op', async () => {
    const harness = createHarness();
    const log = memoryLog();
    const ingest = createIngest({ log, clock: harness.clock, ids: harness.ids, captureSessionId: harness.captureSessionId });
    await ingest.ingest([]);
    expect(log.writes).toBe(0);
  });
});
