import { describe, expect, it } from 'vitest';
import {
  type DecisionProvider,
  type Page,
  type Thread,
  type Visit,
  DEFAULT_VISIT_POLICY,
  toTimestamp,
} from '@jevtabs/core-domain';
import {
  createCandidateRetriever,
  createHeuristicDecisionProvider,
  createThreadEngine,
  type ThreadProfile,
  type ThreadReadModel,
} from '@jevtabs/thread-engine';
import { FIXTURE_EPOCH, createHarness, makePage, makeThread } from '@jevtabs/test-fixtures';

function visitOf(page: Page, overrides: Partial<Visit> = {}): Visit {
  return {
    schemaVersion: 1,
    visitId: '01930000-0000-7000-8000-000000000001',
    pageId: page.pageId,
    tabKey: '1:1',
    startedAt: toTimestamp(FIXTURE_EPOCH),
    endedAt: toTimestamp(FIXTURE_EPOCH + 600_000),
    foregroundMs: 600_000,
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
    ...overrides,
  };
}

function storeOf(pages: Page[], profiles: ThreadProfile[]): ThreadReadModel {
  return {
    async candidateThreads() {
      return profiles;
    },
    async page(pageId) {
      return pages.find((page) => page.pageId === pageId) ?? null;
    },
    async threadIdsForPage(pageId) {
      return profiles
        .filter((profile) => profile.confirmedPageIds.includes(pageId))
        .map((profile) => profile.thread.threadId);
    },
    async visit() {
      return null;
    },
  };
}

function profileOf(thread: Thread, confirmedPageIds: string[] = []): ThreadProfile {
  return {
    thread,
    summary: thread.title,
    confirmedPageIds,
    hostCounts: {},
  };
}

function engineFor(store: ThreadReadModel, provider?: DecisionProvider) {
  const harness = createHarness();
  const retriever = createCandidateRetriever({ store, clock: harness.clock });
  return createThreadEngine({
    store,
    retriever,
    provider: provider ?? createHeuristicDecisionProvider(),
    clock: harness.clock,
    ids: harness.ids,
  });
}

describe('ThreadEngine', () => {
  it('assigns a Visit to a strongly matching Thread with full provenance', async () => {
    const harness = createHarness();
    const page = makePage(
      'https://github.com/browser-use/jev-ultrafast',
      'browser-use/jev-ultrafast — JEV browser classification',
    );
    const referrer = makePage('https://typesafe.ai/blog/jev', 'Introducing Jev');
    const thread = makeThread(harness, {
      title: 'JEV browser classification',
      keywords: ['jev', 'browser', 'classification', 'ultrafast'],
      lastActivityAt: toTimestamp(FIXTURE_EPOCH),
    });
    const store = storeOf([page, referrer], [profileOf(thread, [referrer.pageId])]);

    const update = await engineFor(store).apply(
      visitOf(page, {
        signals: {
          ...visitOf(page).signals,
          copied: true,
          referrerPageId: referrer.pageId,
        },
      }),
    );

    expect(update.outcome).toBe('assigned');
    expect(update.membership?.threadId).toBe(thread.threadId);
    expect(update.membership?.provider.name).toBe('heuristic');
    expect(update.membership?.rationale.length).toBeGreaterThan(0);
    expect(update.membership?.confidence).toBeGreaterThanOrEqual(
      DEFAULT_VISIT_POLICY.autoAssignConfidence,
    );
    expect(update.evidence?.url).toBe(page.url);
  });

  it('queues a review instead of inventing an assignment when two Threads tie', async () => {
    const harness = createHarness();
    const page = makePage(
      'https://medium.com/modernbert-semantic-routing',
      'ModernBERT semantic routing for evaluation',
    );
    const a = makeThread(harness, {
      title: 'Perceptron eval',
      keywords: ['semantic', 'routing', 'evaluation', 'modernbert'],
      lastActivityAt: toTimestamp(FIXTURE_EPOCH),
    });
    const b = makeThread(harness, {
      title: 'Browser intent memory',
      keywords: ['semantic', 'routing', 'evaluation', 'modernbert'],
      lastActivityAt: toTimestamp(FIXTURE_EPOCH),
    });
    const store = storeOf([page], [profileOf(a), profileOf(b)]);

    const update = await engineFor(store).apply(visitOf(page));

    expect(update.outcome).toBe('review_queued');
    expect(update.membership).toBeNull();
    expect(update.review?.kind).toBe('classification');
    if (update.review?.kind === 'classification') {
      expect(update.review.candidates.length).toBeGreaterThanOrEqual(2);
      expect(update.review.rationale.join(' ')).toContain('two plausible threads');
    }
  });

  it('degrades to review when the provider returns something malformed', async () => {
    const page = makePage('https://example.com/article', 'A long article about sessionization');
    const store = storeOf([page], []);
    const broken: DecisionProvider = {
      name: 'broken',
      version: '0.0.1',
      async choose() {
        return { kind: 'teleport' } as never;
      },
    };

    const update = await engineFor(store, broken).apply(visitOf(page));
    expect(update.outcome).toBe('review_queued');
    if (update.review?.kind === 'classification') {
      expect(update.review.rationale.join(' ')).toContain('provider unavailable');
    }
  });

  it('degrades to review when the provider throws', async () => {
    const page = makePage('https://example.com/article', 'A long article about sessionization');
    const store = storeOf([page], []);
    const offline: DecisionProvider = {
      name: 'offline',
      version: '0.0.1',
      async choose() {
        throw new Error('network unavailable');
      },
    };
    const update = await engineFor(store, offline).apply(visitOf(page));
    expect(update.outcome).toBe('review_queued');
  });

  it('ignores Visits that are still open or were never meaningful', async () => {
    const page = makePage('https://example.com/a', 'A');
    const store = storeOf([page], []);
    const engine = engineFor(store);

    expect((await engine.apply(visitOf(page, { status: 'open' }))).outcome).toBe('skipped');
    expect((await engine.apply(visitOf(page, { meaningful: false }))).outcome).toBe('skipped');
  });

  it('reactivates a dormant Thread rather than creating a duplicate', async () => {
    const harness = createHarness();
    const page = makePage(
      'https://example-travel.com/beijing/waldorf-astoria',
      '北京華爾道夫酒店 冬季住房',
    );
    const thread = makeThread(harness, {
      title: '北京家庭旅行',
      keywords: ['北京', '華爾道夫', '旅行', '酒店'],
      status: 'dormant',
      lastActivityAt: toTimestamp(FIXTURE_EPOCH - 12 * 24 * 60 * 60 * 1000),
    });
    const store = storeOf([page], [profileOf(thread, [page.pageId])]);

    const update = await engineFor(store).apply(
      visitOf(page, {
        signals: { ...visitOf(page).signals, selected: true, activationCount: 3 },
      }),
    );

    expect(update.outcome).toBe('assigned');
    expect(update.thread?.threadId).toBe(thread.threadId);
    expect(update.thread?.status).toBe('active');
  });

  it('creates a new Thread for sustained work that matches nothing', async () => {
    const page = makePage(
      'https://example.com/guides/streaming-asr-latency',
      'Streaming ASR latency budgets',
    );
    const store = storeOf([page], []);
    const update = await engineFor(store).apply(
      visitOf(page, { signals: { ...visitOf(page).signals, copied: true } }),
    );

    expect(update.outcome).toBe('created');
    expect(update.thread?.origin).toBe('auto');
    expect(update.thread?.confirmed).toBe(false);
    expect(update.thread?.title).toContain('Streaming ASR');
  });

  it('treats an ambient surface as noise unless the person engaged with it', async () => {
    const page = makePage('https://mail.google.com/mail/u/0/', 'Inbox (18) - Gmail');
    const store = storeOf([page], []);
    const update = await engineFor(store).apply(
      visitOf(page, {
        foregroundMs: 9_000,
        signals: { ...visitOf(page).signals, scrolled: false },
      }),
    );
    expect(update.outcome).toBe('skipped');
  });
});
