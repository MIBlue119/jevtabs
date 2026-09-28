import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdGenerator,
  fixedClock,
  seededRandom,
  toTimestamp,
  type BrowserEventDraft,
} from '@jevtabs/core-domain';
import { interleavedMorning } from '@jevtabs/test-fixtures';
import { CapturePipeline } from '../src/background/pipeline.js';
import { JevTabsDatabase, setDatabase } from '../src/storage/db.js';
import { loadSettings, saveSettings } from '../src/storage/repository.js';

/**
 * End-to-end capture tests against a real IndexedDB.
 *
 * These cover the acceptance criteria the plan sets for the first vertical
 * slice: a valid Visit timeline from real navigation, background tabs left
 * alone, pause and exclusion honoured, and survival of a service-worker kill at
 * an arbitrary point with neither loss nor duplication.
 */

let database: JevTabsDatabase;
let counter = 0;

function pipelineFor(startMs: number): CapturePipeline {
  const clock = fixedClock(startMs);
  const ids = createIdGenerator(clock, seededRandom(11));
  return new CapturePipeline({
    database,
    clock,
    ids,
    captureSessionId: '01930000-0000-7000-8000-0000000000aa',
  });
}

/** The fixture tape, stripped back to the drafts a browser adapter emits. */
function drafts(): BrowserEventDraft[] {
  return interleavedMorning().events.map((event) => {
    const {
      schemaVersion: _v,
      eventId: _i,
      recordedAt: _r,
      captureSessionId: _c,
      ...draft
    } = event;
    return draft as BrowserEventDraft;
  });
}

beforeEach(async () => {
  counter += 1;
  database = new JevTabsDatabase(`jevtabs-test-${counter}`);
  setDatabase(database);
  await database.open();
});

afterEach(async () => {
  database.close();
  await database.delete();
  setDatabase(null);
});

const AFTER_SESSION = Date.parse('2026-09-18T11:00:00.000Z');

describe('capture pipeline', () => {
  it('turns a browsing session into a Visit timeline', async () => {
    const result = await pipelineFor(AFTER_SESSION).handle(drafts());

    expect(result.stored).toBeGreaterThan(10);
    expect(result.rejected).toBe(0);
    const visits = await database.visits.toArray();
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.some((visit) => visit.meaningful)).toBe(true);
    expect(await database.pages.count()).toBeGreaterThan(0);
  });

  it('records no Visit for a tab that was never brought to the foreground', async () => {
    await pipelineFor(AFTER_SESSION).handle(drafts());

    const pages = await database.pages.toArray();
    const stale = pages.find((page) => page.host === 'example-travel.com');
    expect(stale, 'the stale tab is still a known Page').toBeDefined();

    const visits = await database.visits.toArray();
    expect(visits.filter((visit) => visit.pageId === stale?.pageId)).toEqual([]);
  });

  it('never stores a page the content policy refuses', async () => {
    const result = await pipelineFor(AFTER_SESSION).handle([
      {
        type: 'navigation_committed',
        occurredAt: toTimestamp(AFTER_SESSION),
        tabKey: '1:1',
        pageId: 'f'.repeat(32),
        url: 'https://example.com/reset-password?token=JEVTABS_CANARY_RESET_77c1',
        title: 'Reset your password',
        cause: 'typed',
        referrerPageId: null,
      },
    ]);

    expect(result.stored).toBe(0);
    expect(await database.events.count()).toBe(0);
    expect(await database.pages.count()).toBe(0);
  });

  it('records nothing at all while tracking is paused', async () => {
    await saveSettings(database, fixedClock(AFTER_SESSION), { trackingEnabled: false });
    const result = await pipelineFor(AFTER_SESSION).handle(drafts());

    expect(result.stored).toBe(0);
    expect(await database.events.count()).toBe(0);
  });

  it('honours a timed pause and resumes when it expires', async () => {
    const clock = fixedClock(AFTER_SESSION);
    await saveSettings(database, clock, {
      pausedUntil: toTimestamp(AFTER_SESSION + 60_000),
    });

    expect((await pipelineFor(AFTER_SESSION).handle(drafts())).stored).toBe(0);
    expect((await pipelineFor(AFTER_SESSION + 120_000).handle(drafts())).stored).toBeGreaterThan(0);
  });

  it('drops an excluded domain without touching the rest of the session', async () => {
    await saveSettings(database, fixedClock(AFTER_SESSION), { excludedDomains: ['github.com'] });
    await pipelineFor(AFTER_SESSION).handle(drafts());

    const hosts = (await database.pages.toArray()).map((page) => page.host);
    expect(hosts).not.toContain('github.com');
    expect(hosts).toContain('typesafe.ai');
  });

  it('is idempotent: replaying the same batch changes nothing', async () => {
    const batch = drafts();
    await pipelineFor(AFTER_SESSION).handle(batch);

    const firstVisits = await database.visits.toArray();
    const firstEvents = await database.events.count();

    // A second delivery of the same observations — what happens when the
    // adapter retries after a worker restart mid-drain.
    await pipelineFor(AFTER_SESSION).handle(batch);

    const secondVisits = await database.visits.toArray();
    expect(secondVisits.map((visit) => visit.visitId).sort()).toEqual(
      firstVisits.map((visit) => visit.visitId).sort(),
    );
    for (const visit of secondVisits) {
      const before = firstVisits.find((row) => row.visitId === visit.visitId);
      expect(visit.foregroundMs).toBe(before?.foregroundMs);
    }
    // Events are deliberately re-logged under new ids only if they are new;
    // the fold is what must not double-count.
    expect(await database.events.count()).toBeGreaterThanOrEqual(firstEvents);
  });

  it('recovers a fold that was interrupted after the events were durable', async () => {
    const batch = drafts();
    const reference = pipelineFor(AFTER_SESSION);
    await reference.handle(batch);
    const expected = await database.visits.toArray();

    // Simulate a worker killed between "events written" and "fold persisted":
    // the durable log keeps everything, the projection is thrown away.
    await database.visits.clear();
    await database.kv.delete('visit-builder-state');

    const recovered = await pipelineFor(AFTER_SESSION).recover();
    expect(recovered.visitsTouched).toBeGreaterThan(0);

    const after = await database.visits.toArray();
    expect(after.map((visit) => visit.visitId).sort()).toEqual(
      expected.map((visit) => visit.visitId).sort(),
    );
    for (const visit of after) {
      expect(visit.foregroundMs).toBe(
        expected.find((row) => row.visitId === visit.visitId)?.foregroundMs,
      );
    }
  });

  it('survives being killed after every single event', async () => {
    const batch = drafts();
    const whole = pipelineFor(AFTER_SESSION);
    await whole.handle(batch);
    const expected = (await database.visits.toArray()).length;

    await database.delete();
    database = new JevTabsDatabase(`jevtabs-test-${(counter += 1)}`);
    setDatabase(database);
    await database.open();

    // Each event arrives in its own batch through a freshly constructed
    // pipeline, as it would after the worker is torn down between callbacks.
    for (const draft of batch) {
      await pipelineFor(AFTER_SESSION).handle([draft]);
    }

    const visits = await database.visits.toArray();
    expect(visits.length).toBe(expected);
    expect(new Set(visits.map((visit) => visit.visitId)).size).toBe(visits.length);
  });

  it('classifies meaningful Visits into Threads with provenance', async () => {
    await pipelineFor(AFTER_SESSION).handle(drafts());
    await pipelineFor(AFTER_SESSION).flush();

    const threads = await database.threads.toArray();
    const memberships = await database.memberships.toArray();
    expect(threads.length).toBeGreaterThan(0);

    for (const membership of memberships) {
      expect(membership.provider.name).toBe('heuristic');
      expect(membership.provider.version).not.toBe('');
      expect(membership.confidence).toBeGreaterThanOrEqual(0);
      expect(membership.decidedAt).not.toBe('');
    }
  });

  it('assigns each Visit at most one live membership', async () => {
    await pipelineFor(AFTER_SESSION).handle(drafts());
    await pipelineFor(AFTER_SESSION).flush();
    // A second pass must not fork a competing assignment.
    await pipelineFor(AFTER_SESSION).recover();

    const memberships = await database.memberships.toArray();
    const byVisit = new Map<string, number>();
    for (const membership of memberships) {
      if (membership.state !== 'proposed' && membership.state !== 'confirmed') continue;
      byVisit.set(membership.visitId, (byVisit.get(membership.visitId) ?? 0) + 1);
    }
    for (const [visitId, count] of byVisit) {
      expect(count, `visit ${visitId}`).toBe(1);
    }
  });

  it('keeps the strict defaults when settings have never been written', async () => {
    const settings = await loadSettings(database, fixedClock(AFTER_SESSION));
    expect(settings.trackingEnabled).toBe(true);
    expect(settings.excludedDomains).toEqual([]);
    expect(settings.keepDocumentQueryParams).toBe(false);
    expect(settings.retention.keepConfirmedForever).toBe(true);
  });
});
