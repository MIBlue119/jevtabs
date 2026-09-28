import {
  type DecisionProvider,
  type ThreadCandidate,
  type ThreadDecision,
  type VisitFeatures,
  type VisitPolicy,
  DEFAULT_VISIT_POLICY,
  truncate,
} from '@jevtabs/core-domain';
import { isAmbientHost, isSearchHost } from './features.js';

/**
 * The deterministic classifier.
 *
 * It is the mandatory offline fallback and the oracle every other provider is
 * measured against, so it must stay explainable, fast, and free of hidden
 * state. When a smarter adapter is added it sits behind the same interface and
 * this one keeps running whenever that adapter is slow, offline, or malformed.
 */

export const HEURISTIC_PROVIDER_VERSION = '1.0.0';

export interface HeuristicOptions {
  readonly policy?: VisitPolicy;
}

/** Ambiguity: the top two candidates are close enough that guessing is wrong. */
const AMBIGUITY_MARGIN = 0.12;

export function createHeuristicDecisionProvider(options: HeuristicOptions = {}): DecisionProvider {
  const policy = options.policy ?? DEFAULT_VISIT_POLICY;
  const stamp = { name: 'heuristic', version: HEURISTIC_PROVIDER_VERSION };

  return {
    name: stamp.name,
    version: stamp.version,

    async choose(visit: VisitFeatures, candidates: ThreadCandidate[]): Promise<ThreadDecision> {
      const rationale: string[] = [];

      const deliberate =
        visit.signals.copied ||
        visit.signals.selected ||
        visit.foregroundMs >= policy.minForegroundMs * 2 ||
        visit.activationCount >= 3;

      // Ambient surfaces need a much stronger showing before they count as work.
      if (isAmbientHost(visit.host) && !deliberate) {
        return {
          kind: 'noise',
          threadId: null,
          proposedTitle: null,
          confidence: 0.9,
          rationale: ['背景應用程式 · ambient surface', 'no deliberate interaction'],
          provider: stamp,
        };
      }

      const ranked = [...candidates].sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const runnerUp = ranked[1];

      if (top === undefined) {
        if (!deliberate && visit.foregroundMs < policy.minForegroundMs) {
          return {
            kind: 'noise',
            threadId: null,
            proposedTitle: null,
            confidence: 0.6,
            rationale: ['no related thread', 'brief visit'],
            provider: stamp,
          };
        }
        return {
          kind: 'new_thread',
          threadId: null,
          proposedTitle: proposeTitle(visit),
          confidence: 0.55,
          rationale: ['no related thread', 'sustained attention'],
          provider: stamp,
        };
      }

      if (top.signals.navigation === 1) rationale.push('同一導覽路徑 · same navigation path');
      if (top.signals.priorCorrections >= 1)
        rationale.push('你已確認過這個來源 · confirmed source');
      if (top.signals.lexical >= 0.3) rationale.push('標題語義相近 · title overlap');
      if (top.signals.recency >= 0.6) rationale.push('與最近活動同時段 · recent activity');
      if (visit.signals.copied) rationale.push('你複製了內容 · copied content');
      if (visit.activationCount >= 3)
        rationale.push(`切回 ${visit.activationCount} 次 · revisited`);

      const margin = runnerUp === undefined ? 1 : top.score - runnerUp.score;
      const confidence = calibrate(top.score, margin, deliberate);

      if (confidence >= policy.autoAssignConfidence) {
        return {
          kind: 'existing_thread',
          threadId: top.threadId,
          proposedTitle: null,
          confidence,
          rationale: rationale.slice(0, 4),
          provider: stamp,
        };
      }

      // A close second candidate is exactly the case a human resolves in a
      // second and a classifier gets quietly wrong. Ask instead of inventing.
      if (confidence >= policy.reviewFloorConfidence) {
        const ambiguous = runnerUp !== undefined && margin < AMBIGUITY_MARGIN;
        return {
          kind: 'review_required',
          threadId: top.threadId,
          proposedTitle: deliberate ? proposeTitle(visit) : null,
          confidence,
          rationale: [
            ...(ambiguous ? ['可能屬於 2 個 Thread · two plausible threads'] : []),
            ...rationale,
          ].slice(0, 4),
          provider: stamp,
        };
      }

      if (deliberate) {
        return {
          kind: 'new_thread',
          threadId: null,
          proposedTitle: proposeTitle(visit),
          confidence: 0.5,
          rationale: ['與既有 Thread 關聯薄弱 · weak match', 'sustained attention'],
          provider: stamp,
        };
      }

      return {
        kind: 'noise',
        threadId: null,
        proposedTitle: null,
        confidence: 0.7,
        rationale: ['weak match', 'brief visit'],
        provider: stamp,
      };
    },
  };
}

/**
 * Maps a retrieval score to a confidence the thresholds can be tuned against.
 * The margin term matters as much as the score: a strong top candidate with an
 * equally strong runner-up is not a confident decision.
 */
export function calibrate(score: number, margin: number, deliberate: boolean): number {
  const base = Math.min(1, score * 1.35);
  const marginBonus = Math.min(0.2, margin * 0.8);
  const deliberateBonus = deliberate ? 0.08 : 0;
  const ambiguityPenalty = margin < AMBIGUITY_MARGIN ? 0.18 : 0;
  return Math.max(0, Math.min(0.99, base + marginBonus + deliberateBonus - ambiguityPenalty));
}

/** A first-draft Thread title. Always editable; never presented as settled. */
export function proposeTitle(visit: VisitFeatures): string {
  if (isSearchHost(visit.host)) {
    const cleaned = visit.title.replace(/\s*[-–—|]\s*(google|bing|duckduckgo).*/i, '').trim();
    if (cleaned.length > 2) return truncate(cleaned, 80);
  }
  const cleaned = visit.title.replace(/\s*[|·—–-]\s*[^|·—–-]{1,32}$/u, '').trim();
  return truncate(cleaned.length > 3 ? cleaned : visit.host, 80);
}
