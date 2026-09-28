import { describe, expect, it } from 'vitest';
import {
  type BrowserEvent,
  browserEventSchema,
  checkpointSchema,
  defaultSettings,
  evidenceSchema,
  findingSchema,
  pageSchema,
  reviewItemSchema,
  settingsSchema,
  threadMembershipSchema,
  threadSchema,
  visitSchema,
  visitFeaturesSchema,
  toTimestamp,
} from '@jevtabs/core-domain';
import { VisitBuilder, initialVisitBuilderState } from '@jevtabs/capture-engine';
import {
  FIXTURE_EPOCH,
  createHarness,
  interleavedMorning,
  makePage,
  makeThread,
} from '@jevtabs/test-fixtures';

/**
 * Contract tests.
 *
 * Every shape JevTabs records or exports must survive a JSON round trip and
 * re-validate. Storage, export files, and any future native-messaging envelope
 * all cross a serialization boundary, so "it type-checks" is not the same as
 * "it round-trips".
 */

function roundTrip<T>(schema: { parse(value: unknown): T }, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

describe('wire contracts', () => {
  it('validates every event the fixture session produces', () => {
    const { events } = interleavedMorning();
    expect(events.length).toBeGreaterThan(10);
    for (const event of events) {
      expect(browserEventSchema.safeParse(event).success, event.type).toBe(true);
      expect(roundTrip(browserEventSchema, event)).toEqual(event);
    }
  });

  it('validates every Visit the builder emits', () => {
    const { events } = interleavedMorning();
    const builder = new VisitBuilder();
    let state = initialVisitBuilderState();
    let checked = 0;
    for (const event of events) {
      const result = builder.apply(state, event);
      state = result.state;
      for (const visit of result.visits) {
        expect(visitSchema.safeParse(visit).success).toBe(true);
        expect(roundTrip(visitSchema, visit)).toEqual(visit);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('round-trips Page, Thread, and Settings', () => {
    const harness = createHarness();
    const page = makePage('https://typesafe.ai/blog/jev', 'Introducing Jev');
    const thread = makeThread(harness, { title: 'Browser intent memory' });
    const settings = defaultSettings(toTimestamp(FIXTURE_EPOCH));

    expect(roundTrip(pageSchema, page)).toEqual(page);
    expect(roundTrip(threadSchema, thread)).toEqual(thread);
    expect(roundTrip(settingsSchema, settings)).toEqual(settings);
  });

  it('rejects an event with an unknown type rather than storing it', () => {
    const { events } = interleavedMorning();
    const first = events[0] as BrowserEvent;
    expect(browserEventSchema.safeParse({ ...first, type: 'keystroke' }).success).toBe(false);
  });

  it('rejects a timestamp that is not RFC 3339 UTC with millisecond precision', () => {
    const { events } = interleavedMorning();
    const first = events[0] as BrowserEvent;
    for (const bad of ['2026-09-18T09:12:00Z', '2026-09-18 09:12:00.000Z', '1758186720000']) {
      expect(browserEventSchema.safeParse({ ...first, occurredAt: bad }).success, bad).toBe(false);
    }
  });

  it('refuses a ThreadMembership without provider provenance', () => {
    const base = {
      schemaVersion: 1,
      membershipId: '01930000-0000-7000-8000-0000000ad001',
      visitId: '01930000-0000-7000-8000-00000000a001',
      threadId: '01930000-0000-7000-8000-0000000ad002',
      revision: 1,
      state: 'proposed',
      confidence: 0.8,
      rationale: [],
      decidedAt: '2026-09-18T09:30:00.000Z',
      supersedesId: null,
      decidedBy: 'provider',
    };
    expect(threadMembershipSchema.safeParse(base).success).toBe(false);
    expect(
      threadMembershipSchema.safeParse({
        ...base,
        provider: { name: 'heuristic', version: '1.0.0' },
      }).success,
    ).toBe(true);
  });

  it('keeps every schema addressable for the generator', () => {
    for (const schema of [
      evidenceSchema,
      findingSchema,
      checkpointSchema,
      reviewItemSchema,
      visitFeaturesSchema,
    ]) {
      expect(typeof schema.safeParse).toBe('function');
    }
  });
});
