import { describe, expect, it } from 'vitest';
import { DEFAULT_VISIT_POLICY, MINUTE_MS, SECOND_MS, type Visit } from '@jevtabs/core-domain';
import { VisitBuilder, initialVisitBuilderState } from '@jevtabs/capture-engine';
import { interleavedMorning } from '@jevtabs/test-fixtures';

function replay(events: ReturnType<typeof interleavedMorning>['events'], builder: VisitBuilder) {
  const merged = new Map<string, Visit>();
  let state = initialVisitBuilderState();
  for (const event of events) {
    const result = builder.apply(state, event);
    state = result.state;
    for (const visit of result.visits) merged.set(visit.visitId, visit);
  }
  return { state, visits: merged };
}

describe('VisitBuilder', () => {
  it('never opens a Visit for a tab that only loaded in the background', () => {
    const session = interleavedMorning();
    const builder = new VisitBuilder();
    const { visits } = replay(session.events, builder);

    const staleTripVisits = [...visits.values()].filter(
      (visit) => visit.pageId === session.pages.staleTrip.pageId,
    );
    expect(staleTripVisits).toEqual([]);
  });

  it('gives a background tab no foreground time before it is activated', () => {
    const session = interleavedMorning();
    const builder = new VisitBuilder();
    const { visits } = replay(session.events, builder);

    // The repo tab loaded at minute 19 and was activated at minute 22.
    const repo = [...visits.values()].find(
      (visit) => visit.pageId === session.pages.repo.pageId,
    );
    expect(repo).toBeDefined();
    expect(repo?.startedAt).toBe('2026-09-18T09:22:00.000Z');
  });

  it('caps a span when the person walks away mid-page', () => {
    const session = interleavedMorning();
    const builder = new VisitBuilder();
    const { visits } = replay(session.events, builder);

    // Idle began at minute 34 after last activity at minute 29; the idle
    // timeout is 90s, so at most 90s past the last sign of life is counted.
    const performance = [...visits.values()].find(
      (visit) => visit.pageId === session.pages.performance.pageId,
    );
    expect(performance).toBeDefined();
    const lunchSpan = performance?.spans.find((span) => span.closedBy === 'idle');
    expect(lunchSpan?.endedAt).toBe('2026-09-18T09:30:30.000Z');
  });

  it('is idempotent under replay: the same tape converges on the same Visits', () => {
    const session = interleavedMorning();
    const a = replay(session.events, new VisitBuilder());
    const b = replay(session.events, new VisitBuilder());

    const shape = (visits: Map<string, Visit>) =>
      [...visits.values()]
        .map((visit) => ({
          pageId: visit.pageId,
          startedAt: visit.startedAt,
          foregroundMs: visit.foregroundMs,
          meaningful: visit.meaningful,
          activationCount: visit.signals.activationCount,
        }))
        .sort((x, y) => (x.startedAt + x.pageId < y.startedAt + y.pageId ? -1 : 1));

    expect(shape(a.visits)).toEqual(shape(b.visits));
  });

  it('survives termination at any point without duplicating a Visit', () => {
    const session = interleavedMorning();
    const builder = new VisitBuilder();
    const reference = replay(session.events, builder);

    // Simulate the service worker dying after every event: the state is
    // round-tripped through JSON exactly as `chrome.storage` would do.
    const resumeBuilder = new VisitBuilder();
    const merged = new Map<string, Visit>();
    let state = initialVisitBuilderState();
    for (const event of session.events) {
      state = JSON.parse(JSON.stringify(state));
      const result = resumeBuilder.apply(state, event);
      state = result.state;
      for (const visit of result.visits) merged.set(visit.visitId, visit);
    }

    expect(merged.size).toBe(reference.visits.size);
    for (const [visitId, visit] of merged) {
      expect(reference.visits.get(visitId)?.foregroundMs).toBe(visit.foregroundMs);
    }
  });

  it('resumes the same Visit when the person returns to a page shortly after', () => {
    const builder = new VisitBuilder();
    const session = interleavedMorning();
    const { visits } = replay(session.events, builder);

    const repo = [...visits.values()].filter(
      (visit) => visit.pageId === session.pages.repo.pageId,
    );
    // Read, glanced at mail, came straight back: one Visit, two activations.
    expect(repo).toHaveLength(1);
    expect(repo[0]?.signals.activationCount).toBe(2);
  });

  it('marks a copy as meaningful even when the visit was short', () => {
    const builder = new VisitBuilder();
    expect(
      builder.isMeaningful(1_000, {
        scrolled: false,
        selected: false,
        copied: true,
        mediaPlayback: false,
        activationCount: 1,
        cause: 'link',
        referrerPageId: null,
      }),
    ).toBe(true);
  });

  it('does not count time while tracking is paused', () => {
    const builder = new VisitBuilder();
    const session = interleavedMorning();
    const paused = session.events.map((event, index) =>
      index === 4
        ? ({
            ...event,
            type: 'tracking_changed' as const,
            enabled: false,
            reason: 'user' as const,
          } as (typeof session.events)[number])
        : event,
    );
    const { visits } = replay(paused, builder);
    const total = [...visits.values()].reduce((sum, visit) => sum + visit.foregroundMs, 0);
    const reference = replay(session.events, new VisitBuilder());
    const referenceTotal = [...reference.visits.values()].reduce(
      (sum, visit) => sum + visit.foregroundMs,
      0,
    );
    expect(total).toBeLessThan(referenceTotal);
  });

  it('flushes open Visits so none dangle across a browser restart', () => {
    const builder = new VisitBuilder();
    const session = interleavedMorning();
    const { state } = replay(session.events.slice(0, 8), builder);
    const flushed = builder.flush(state, '2026-09-18T10:00:00.000Z');

    expect(Object.keys(flushed.state.open)).toHaveLength(0);
    for (const visit of flushed.visits) expect(visit.status).toBe('closed');
  });

  it('honours the configured meaningfulness threshold', () => {
    const strict = new VisitBuilder({
      policy: { ...DEFAULT_VISIT_POLICY, minForegroundMs: 30 * SECOND_MS },
    });
    const relaxed = new VisitBuilder({
      policy: { ...DEFAULT_VISIT_POLICY, minForegroundMs: 1 * SECOND_MS },
    });
    const session = interleavedMorning();
    const strictMeaningful = [...replay(session.events, strict).visits.values()].filter(
      (visit) => visit.meaningful,
    ).length;
    const relaxedMeaningful = [...replay(session.events, relaxed).visits.values()].filter(
      (visit) => visit.meaningful,
    ).length;
    expect(relaxedMeaningful).toBeGreaterThanOrEqual(strictMeaningful);
  });

  it('keeps total foreground time below wall-clock time', () => {
    const session = interleavedMorning();
    const { visits } = replay(session.events, new VisitBuilder());
    const total = [...visits.values()].reduce((sum, visit) => sum + visit.foregroundMs, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(104 * MINUTE_MS);
  });
});
