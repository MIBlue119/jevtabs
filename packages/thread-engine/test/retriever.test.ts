import { describe, expect, it } from 'vitest';
import { DAY_MS, type Visit } from '@jevtabs/core-domain';
import {
  RETRIEVAL_WEIGHTS,
  isAmbientHost,
  isSearchHost,
  scoreCandidate,
} from '@jevtabs/thread-engine';
import { FIXTURE_EPOCH, createHarness, makePage, makeThread } from '@jevtabs/test-fixtures';

const harness = createHarness();
const page = makePage('https://github.com/browser-use/jev-ultrafast', 'browser-use/jev-ultrafast');

function visitWith(referrerPageId: string | null): Visit {
  return {
    schemaVersion: 1,
    visitId: '01930000-0000-7000-8000-00000000a001',
    pageId: page.pageId,
    tabKey: '1:1',
    startedAt: '2026-09-18T09:00:00.000Z',
    endedAt: '2026-09-18T09:10:00.000Z',
    foregroundMs: 600_000,
    spans: [],
    signals: {
      scrolled: true,
      selected: false,
      copied: false,
      mediaPlayback: false,
      activationCount: 1,
      cause: 'link',
      referrerPageId,
    },
    status: 'closed',
    meaningful: true,
    captureSessionId: '01930000-0000-7000-8000-0000000000ff',
  };
}

const profile = {
  thread: makeThread(harness, {
    title: 'jev ultrafast',
    keywords: ['jev', 'ultrafast', 'browser'],
    lastActivityAt: '2026-09-18T09:00:00.000Z',
  }),
  summary: 'Evaluating jev for browser classification',
  confirmedPageIds: [] as string[],
  hostCounts: {} as Record<string, number>,
};

describe('candidate scoring', () => {
  it('weights the four signals as documented', () => {
    const total =
      RETRIEVAL_WEIGHTS.lexical +
      RETRIEVAL_WEIGHTS.recency +
      RETRIEVAL_WEIGHTS.navigation +
      RETRIEVAL_WEIGHTS.priorCorrections;
    expect(total).toBeCloseTo(1, 10);
  });

  it('decays recency without ever dropping a dormant Thread to zero', () => {
    const fresh = scoreCandidate(profile, page, visitWith(null), FIXTURE_EPOCH);
    const stale = scoreCandidate(
      { ...profile, thread: { ...profile.thread, lastActivityAt: '2026-09-01T09:00:00.000Z' } },
      page,
      visitWith(null),
      FIXTURE_EPOCH + 17 * DAY_MS,
    );
    expect(fresh.signals.recency).toBeGreaterThan(stale.signals.recency);
    expect(stale.score).toBeGreaterThan(0);
  });

  it('rewards arriving from a page the Thread already owns', () => {
    const referrer = makePage('https://typesafe.ai/blog/jev', 'Introducing Jev');
    const withNav = scoreCandidate(
      { ...profile, confirmedPageIds: [referrer.pageId] },
      page,
      visitWith(referrer.pageId),
      FIXTURE_EPOCH,
    );
    const withoutNav = scoreCandidate(profile, page, visitWith(null), FIXTURE_EPOCH);
    expect(withNav.signals.navigation).toBe(1);
    expect(withNav.score).toBeGreaterThan(withoutNav.score);
  });

  it('saturates host affinity so one busy domain cannot dominate', () => {
    const three = scoreCandidate(
      { ...profile, hostCounts: { 'github.com': 3 } },
      page,
      visitWith(null),
      FIXTURE_EPOCH,
    );
    const thirty = scoreCandidate(
      { ...profile, hostCounts: { 'github.com': 30 } },
      page,
      visitWith(null),
      FIXTURE_EPOCH,
    );
    expect(thirty.signals.priorCorrections).toBe(three.signals.priorCorrections);
  });

  it('never exceeds the score bounds', () => {
    const maxed = scoreCandidate(
      { ...profile, confirmedPageIds: [page.pageId], hostCounts: { 'github.com': 99 } },
      page,
      visitWith(page.pageId),
      FIXTURE_EPOCH,
    );
    expect(maxed.score).toBeLessThanOrEqual(1);
    expect(maxed.score).toBeGreaterThanOrEqual(0);
  });
});

describe('surface classification', () => {
  it('recognizes ambient apps and their subdomains', () => {
    expect(isAmbientHost('mail.google.com')).toBe(true);
    expect(isAmbientHost('teams.microsoft.com')).toBe(true);
    expect(isAmbientHost('github.com')).toBe(false);
  });

  it('recognizes search waypoints', () => {
    expect(isSearchHost('google.com')).toBe(true);
    expect(isSearchHost('typesafe.ai')).toBe(false);
  });
});
