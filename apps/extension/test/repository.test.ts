import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdGenerator,
  fixedClock,
  seededRandom,
  toTimestamp,
  type BrowserEvent,
  type Evidence,
  type ReviewItem,
} from '@jevtabs/core-domain';
import { makePage, makeThread, createHarness } from '@jevtabs/test-fixtures';
import { JevTabsDatabase, setDatabase } from '../src/storage/db.js';
import {
  acceptHighConfidence,
  addFinding,
  applyRetention,
  createCheckpoint,
  deleteThread,
  purgeDomain,
  refreshDormancy,
  resolveClassification,
  saveSettings,
  setFindingState,
} from '../src/storage/repository.js';
import { exportAll, exportMarkdown } from '../src/storage/export.js';

/**
 * Storage behaviour that the product's promises rest on: corrections append,
 * exclusion actually erases, deletion leaves a tombstone and nothing else, and
 * retention never touches confirmed knowledge.
 */

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
let database: JevTabsDatabase;
let counter = 0;

function context() {
  const clock = fixedClock(NOW);
  return { database, clock, ids: createIdGenerator(clock, seededRandom(3)) };
}

beforeEach(async () => {
  counter += 1;
  database = new JevTabsDatabase(`jevtabs-repo-${counter}`);
  setDatabase(database);
  await database.open();
});

afterEach(async () => {
  database.close();
  await database.delete();
  setDatabase(null);
});

async function seedThreadWithVisit(): Promise<{
  threadId: string;
  visitId: string;
  pageId: string;
}> {
  const harness = createHarness();
  const thread = makeThread(harness, { title: 'Browser intent memory' });
  const page = makePage('https://typesafe.ai/blog/jev', 'Introducing Jev');
  const visitId = '01930000-0000-7000-8000-0000000aa001';

  await database.threads.put(thread);
  await database.pages.put(page);
  await database.visits.put({
    schemaVersion: 1,
    visitId,
    pageId: page.pageId,
    tabKey: '1:1',
    startedAt: toTimestamp(NOW - 600_000),
    endedAt: toTimestamp(NOW - 300_000),
    foregroundMs: 300_000,
    spans: [],
    signals: {
      scrolled: true,
      selected: false,
      copied: false,
      mediaPlayback: false,
      activationCount: 1,
      cause: 'link',
      referrerPageId: null,
    },
    status: 'closed',
    meaningful: true,
    captureSessionId: '01930000-0000-7000-8000-0000000000ff',
  });

  return { threadId: thread.threadId, visitId, pageId: page.pageId };
}

type ClassificationReview = Extract<ReviewItem, { kind: 'classification' }>;

function classificationReview(visitId: string, threadId: string): ClassificationReview {
  return {
    schemaVersion: 1,
    reviewId: '01930000-0000-7000-8000-0000000cc001',
    kind: 'classification',
    status: 'open',
    createdAt: toTimestamp(NOW),
    resolvedAt: null,
    visitId,
    candidates: [
      {
        threadId,
        title: 'Browser intent memory',
        summary: '',
        keywords: [],
        lastActivityAt: toTimestamp(NOW),
        status: 'active',
        signals: { lexical: 0.5, recency: 0.9, navigation: 0, priorCorrections: 0 },
        score: 0.6,
      },
    ],
    suggestedThreadId: threadId,
    confidence: 0.62,
    rationale: ['title overlap'],
    provider: { name: 'heuristic', version: '1.0.0' },
  };
}

describe('review resolution', () => {
  it('records a human decision as a confirmed membership with evidence', async () => {
    const { threadId, visitId } = await seedThreadWithVisit();
    await database.reviews.put(classificationReview(visitId, threadId));

    await resolveClassification(context(), '01930000-0000-7000-8000-0000000cc001', threadId);

    const memberships = await database.memberships.toArray();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.state).toBe('confirmed');
    expect(memberships[0]?.decidedBy).toBe('human');
    expect(memberships[0]?.confidence).toBe(1);

    const thread = await database.threads.get(threadId);
    expect(thread?.confirmed).toBe(true);
    expect(await database.evidence.count()).toBe(1);
    expect((await database.reviews.get('01930000-0000-7000-8000-0000000cc001'))?.status).toBe(
      'resolved',
    );
  });

  it('appends a revision when a decision is later corrected', async () => {
    const { threadId, visitId } = await seedThreadWithVisit();
    const other = makeThread(createHarness(), { title: 'Perceptron eval' });
    await database.threads.put(other);
    await database.reviews.put(classificationReview(visitId, threadId));

    await resolveClassification(context(), '01930000-0000-7000-8000-0000000cc001', threadId);
    await database.reviews.put({ ...classificationReview(visitId, threadId), status: 'open' });
    await resolveClassification(context(), '01930000-0000-7000-8000-0000000cc001', other.threadId);

    const memberships = (await database.memberships.toArray()).sort(
      (a, b) => a.revision - b.revision,
    );
    expect(memberships).toHaveLength(2);
    expect(memberships[0]?.state, 'the original decision is kept, not overwritten').toBe(
      'corrected',
    );
    expect(memberships[1]?.revision).toBe(2);
    expect(memberships[1]?.threadId).toBe(other.threadId);
    expect(memberships[1]?.supersedesId).toBe(memberships[0]?.membershipId);
  });

  it('marking a visit as "not work" withdraws the assignment but keeps the Visit', async () => {
    const { threadId, visitId } = await seedThreadWithVisit();
    await database.reviews.put(classificationReview(visitId, threadId));
    await resolveClassification(context(), '01930000-0000-7000-8000-0000000cc001', threadId);
    await database.reviews.put({ ...classificationReview(visitId, threadId), status: 'open' });
    await resolveClassification(context(), '01930000-0000-7000-8000-0000000cc001', null);

    const live = (await database.memberships.toArray()).filter(
      (row) => row.state === 'proposed' || row.state === 'confirmed',
    );
    expect(live).toEqual([]);
    expect(await database.visits.get(visitId)).toBeDefined();
  });

  it('accepts only suggestions above the confidence floor in bulk', async () => {
    const { threadId, visitId } = await seedThreadWithVisit();
    await database.reviews.put(classificationReview(visitId, threadId));
    const lowConfidence: ClassificationReview = {
      ...classificationReview(visitId, threadId),
      reviewId: '01930000-0000-7000-8000-0000000cc002',
      confidence: 0.2,
    };
    await database.reviews.put(lowConfidence);

    const resolved = await acceptHighConfidence(context(), 0.5);
    expect(resolved).toBe(1);
    expect((await database.reviews.get('01930000-0000-7000-8000-0000000cc002'))?.status).toBe(
      'open',
    );
  });
});

describe('findings', () => {
  it('keeps an agent proposal auditable after a human decides on it', async () => {
    const { threadId } = await seedThreadWithVisit();
    const finding = await addFinding(context(), threadId, 'Visits, not tabs.');
    await database.findings.put({ ...finding, provenance: 'agent_proposed', state: 'proposed' });

    await setFindingState(context(), finding.findingId, 'confirmed');

    const stored = await database.findings.get(finding.findingId);
    expect(stored?.state).toBe('confirmed');
    expect(stored?.revision).toBe(2);
    expect(stored?.author).toBe('you');
  });
});

describe('checkpoints', () => {
  it('captures the resume state and pauses the Thread', async () => {
    const { threadId } = await seedThreadWithVisit();
    await addFinding(context(), threadId, 'Sessionization happens per Visit.');

    const checkpoint = await createCheckpoint(context(), {
      threadId,
      title: 'Settled on Visit-based sessionization',
      nextAction: 'Prototype candidate retrieval',
      openQuestions: ['How do we measure reactivation accuracy?', '  '],
      pauseThread: true,
    });

    expect(checkpoint.settledFindings).toHaveLength(1);
    expect(checkpoint.openQuestions, 'blank questions are dropped').toHaveLength(1);
    expect((await database.threads.get(threadId))?.status).toBe('paused');
  });
});

describe('exclusion and deletion', () => {
  it('erases everything already recorded for an excluded domain', async () => {
    const { threadId, visitId, pageId } = await seedThreadWithVisit();
    await database.evidence.put({
      schemaVersion: 1,
      evidenceId: '01930000-0000-7000-8000-0000000ee001',
      threadId,
      visitId,
      pageId,
      title: 'Introducing Jev',
      url: 'https://typesafe.ai/blog/jev',
      role: 'primary',
      excerpt: null,
      capturedAt: toTimestamp(NOW),
    } satisfies Evidence);

    const removed = await purgeDomain(context(), 'typesafe.ai');

    expect(removed).toBe(1);
    expect(await database.pages.count()).toBe(0);
    expect(await database.visits.count()).toBe(0);
    expect(await database.evidence.count()).toBe(0);
    expect(await database.tombstones.count()).toBe(1);
  });

  it('leaves a tombstone that records the deletion but not its content', async () => {
    const { threadId } = await seedThreadWithVisit();
    await addFinding(context(), threadId, 'A secret conclusion about something private.');

    await deleteThread(context(), threadId);

    expect(await database.threads.count()).toBe(0);
    expect(await database.findings.count()).toBe(0);
    const tombstone = (await database.tombstones.toArray())[0];
    expect(tombstone?.entity).toBe('thread');
    expect(JSON.stringify(tombstone)).not.toContain('secret conclusion');
  });
});

describe('retention', () => {
  it('expires the raw tape but never confirmed knowledge', async () => {
    const { threadId, visitId, pageId } = await seedThreadWithVisit();
    await addFinding(context(), threadId, 'Kept forever.');
    await database.evidence.put({
      schemaVersion: 1,
      evidenceId: '01930000-0000-7000-8000-0000000ee002',
      threadId,
      visitId,
      pageId,
      title: 'Introducing Jev',
      url: 'https://typesafe.ai/blog/jev',
      role: 'primary',
      excerpt: null,
      capturedAt: toTimestamp(NOW),
    } satisfies Evidence);

    const oldEvent: BrowserEvent = {
      schemaVersion: 1,
      eventId: '01930000-0000-8000-8000-0000000fe001',
      occurredAt: toTimestamp(NOW - 90 * 24 * 60 * 60 * 1000),
      recordedAt: toTimestamp(NOW - 90 * 24 * 60 * 60 * 1000),
      captureSessionId: '01930000-0000-7000-8000-0000000000ff',
      type: 'tab_closed',
      tabKey: '1:1',
    };
    await database.events.put(oldEvent);

    const result = await applyRetention(context());

    expect(result.events).toBe(1);
    expect(await database.findings.count(), 'confirmed findings survive').toBe(1);
    expect(await database.visits.count(), 'a promoted Visit survives').toBe(1);
  });

  it('marks a quiet Thread dormant rather than deleting it', async () => {
    const harness = createHarness();
    await database.threads.put(
      makeThread(harness, {
        title: 'Old work',
        status: 'active',
        lastActivityAt: toTimestamp(NOW - 30 * 24 * 60 * 60 * 1000),
      }),
    );

    expect(await refreshDormancy(context())).toBe(1);
    expect((await database.threads.toArray())[0]?.status).toBe('dormant');
  });
});

describe('export', () => {
  it('excludes the raw event tape unless explicitly asked for', async () => {
    const { threadId } = await seedThreadWithVisit();
    await addFinding(context(), threadId, 'The unit is the Visit.');

    const bundle = await exportAll(database, fixedClock(NOW));
    expect(bundle.events).toBeUndefined();
    expect(bundle.threads).toHaveLength(1);
    expect(bundle.format).toBe('jevtabs.export.v1');

    const withEvents = await exportAll(database, fixedClock(NOW), { includeRawEvents: true });
    expect(withEvents.events).toBeDefined();
  });

  it('renders a readable Markdown archive', async () => {
    const { threadId } = await seedThreadWithVisit();
    await addFinding(context(), threadId, 'The unit is the Visit.');

    const markdown = await exportMarkdown(database, fixedClock(NOW));
    expect(markdown).toContain('# JevTabs export');
    expect(markdown).toContain('Browser intent memory');
    expect(markdown).toContain('The unit is the Visit.');
  });

  it('round-trips through JSON without losing a field', async () => {
    await seedThreadWithVisit();
    const bundle = await exportAll(database, fixedClock(NOW));
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });
});

describe('settings', () => {
  it('validates on write, so an invalid patch cannot be persisted', async () => {
    await expect(
      saveSettings(database, fixedClock(NOW), { retention: { rawEventDays: 9999 } as never }),
    ).rejects.toThrow();
  });
});
