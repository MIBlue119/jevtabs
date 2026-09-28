import {
  type CandidateRetriever,
  type Page,
  type ThreadCandidate,
  type Visit,
  type Clock,
  DAY_MS,
  fromTimestamp,
  termOverlap,
  termsOf,
  truncate,
} from '@jevtabs/core-domain';
import type { ThreadProfile, ThreadReadModel } from './store.js';

/**
 * Candidate retrieval narrows every Thread down to the three-to-five a
 * decision could plausibly be about. It is deliberately cheap and explainable:
 * four named signals the UI can show back to the person as "why we asked".
 *
 * Embeddings belong here later, behind the same interface, and only once the
 * lexical baseline has been measured.
 */

export const RETRIEVAL_WEIGHTS = {
  lexical: 0.4,
  recency: 0.2,
  navigation: 0.25,
  priorCorrections: 0.15,
} as const;

/** Recency decays with a three-day half-life: dormant work stays reachable. */
const RECENCY_HALF_LIFE_MS = 3 * DAY_MS;

export interface RetrieverOptions {
  readonly store: ThreadReadModel;
  readonly clock: Clock;
  /** Threads scanned per call. Personal-scale data, so a full scan is fine. */
  readonly scanLimit?: number;
}

function recencyScore(lastActivityAt: string, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - fromTimestamp(lastActivityAt));
  return 2 ** (-ageMs / RECENCY_HALF_LIFE_MS);
}

function navigationScore(profile: ThreadProfile, referrerPageId: string | null): number {
  if (referrerPageId === null) return 0;
  return profile.confirmedPageIds.includes(referrerPageId) ? 1 : 0;
}

function priorCorrectionScore(profile: ThreadProfile, page: Page): number {
  if (profile.confirmedPageIds.includes(page.pageId)) return 1;
  const hostHits = profile.hostCounts[page.host] ?? 0;
  if (hostHits === 0) return 0;
  // Saturates quickly: three pages from a host is as strong a hint as thirty.
  return Math.min(1, hostHits / 3) * 0.6;
}

export function scoreCandidate(
  profile: ThreadProfile,
  page: Page,
  visit: Visit,
  nowMs: number,
): ThreadCandidate {
  const visitTerms = [...termsOf(page.title), ...termsOf(page.host.replace(/\./g, ' '))];
  const signals = {
    lexical: termOverlap(visitTerms, profile.thread.keywords),
    recency: recencyScore(profile.thread.lastActivityAt, nowMs),
    navigation: navigationScore(profile, visit.signals.referrerPageId),
    priorCorrections: priorCorrectionScore(profile, page),
  };

  const score =
    signals.lexical * RETRIEVAL_WEIGHTS.lexical +
    signals.recency * RETRIEVAL_WEIGHTS.recency +
    signals.navigation * RETRIEVAL_WEIGHTS.navigation +
    signals.priorCorrections * RETRIEVAL_WEIGHTS.priorCorrections;

  return {
    threadId: profile.thread.threadId,
    title: profile.thread.title,
    summary: truncate(profile.summary, 400),
    keywords: [...profile.thread.keywords],
    lastActivityAt: profile.thread.lastActivityAt,
    status: profile.thread.status,
    signals,
    score: Math.min(1, score),
  };
}

export function createCandidateRetriever(options: RetrieverOptions): CandidateRetriever {
  const scanLimit = options.scanLimit ?? 200;

  return {
    async forVisit(visit, limit) {
      const page = await options.store.page(visit.pageId);
      if (page === null) return [];
      const profiles = await options.store.candidateThreads({ limit: scanLimit });
      const nowMs = options.clock.now();

      return profiles
        .map((profile) => scoreCandidate(profile, page, visit, nowMs))
        .filter((candidate) => candidate.score > 0.02)
        .sort((a, b) => b.score - a.score || (a.threadId < b.threadId ? -1 : 1))
        .slice(0, limit);
    },
  };
}
