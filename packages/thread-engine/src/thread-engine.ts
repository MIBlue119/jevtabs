import {
  type CandidateRetriever,
  type Clock,
  type DecisionProvider,
  type Evidence,
  type EvidenceRole,
  type IdGenerator,
  type Page,
  type ReviewItem,
  type Thread,
  type ThreadAccent,
  type ThreadEngine,
  type ThreadMembership,
  type ThreadUpdate,
  type Visit,
  type VisitPolicy,
  DEFAULT_VISIT_POLICY,
  dedupe,
  fromTimestamp,
  termsOf,
  threadDecisionSchema,
  toTimestamp,
  truncate,
} from '@jevtabs/core-domain';
import { isSearchHost, visitFeatures } from './features.js';
import type { ThreadReadModel } from './store.js';

/**
 * Turns one meaningful Visit into durable Thread state.
 *
 * The engine only produces entities; persisting them is the adapter's job, and
 * must happen in a single transaction so a terminated service worker leaves
 * either all of an assignment or none of it.
 *
 * Three invariants are enforced here rather than at the database:
 *   - low confidence produces a ReviewItem, never an invented assignment;
 *   - every assignment records provider, version, confidence, and rationale;
 *   - a provider decision is validated before it is trusted, so a malformed
 *     adapter degrades to review instead of corrupting the graph.
 */

const ACCENTS: readonly ThreadAccent[] = ['green', 'blue', 'violet', 'amber', 'gray'];

export interface ThreadEngineOptions {
  readonly store: ThreadReadModel;
  readonly retriever: CandidateRetriever;
  readonly provider: DecisionProvider;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly policy?: VisitPolicy;
  /** How many candidates to offer the provider. The plan calls for 3–5. */
  readonly candidateLimit?: number;
  /** Used only to pick a stable accent colour for new Threads. */
  readonly threadCountHint?: () => number;
}

export function evidenceRoleFor(page: Page, visit: Visit, isFirstInThread: boolean): EvidenceRole {
  if (isSearchHost(page.host)) return 'search';
  if (/(^|\.)(github|gitlab|bitbucket)\.com$/.test(page.host)) return 'implementation';
  if (visit.signals.copied || visit.signals.selected) return 'evidence';
  if (isFirstInThread) return 'primary';
  return 'reference';
}

export function createThreadEngine(options: ThreadEngineOptions): ThreadEngine {
  const policy = options.policy ?? DEFAULT_VISIT_POLICY;
  const candidateLimit = options.candidateLimit ?? 5;

  const skipped = (visitId: string): ThreadUpdate => ({
    visitId,
    thread: null,
    membership: null,
    evidence: null,
    review: null,
    outcome: 'skipped',
  });

  return {
    async apply(visit: Visit): Promise<ThreadUpdate> {
      // Only closed, meaningful Visits are classified. An open Visit is still
      // accruing attention and would be classified on partial evidence.
      if (!visit.meaningful || visit.status !== 'closed') return skipped(visit.visitId);

      const page = await options.store.page(visit.pageId);
      if (page === null) return skipped(visit.visitId);

      const now = toTimestamp(options.clock.now());
      const referrerThreadIds =
        visit.signals.referrerPageId === null
          ? []
          : await options.store.threadIdsForPage(visit.signals.referrerPageId);

      const candidates = await options.retriever.forVisit(visit, candidateLimit);
      const features = visitFeatures(visit, page, referrerThreadIds);

      let decision;
      try {
        decision = threadDecisionSchema.parse(await options.provider.choose(features, candidates));
      } catch {
        // A provider that times out, goes offline, or returns a shape we do not
        // recognize is a normal degraded state — it must never lose the Visit.
        decision = {
          kind: 'review_required' as const,
          threadId: candidates[0]?.threadId ?? null,
          proposedTitle: null,
          confidence: 0,
          rationale: ['provider unavailable · 分類器暫時無法使用'],
          provider: { name: options.provider.name, version: options.provider.version },
        };
      }

      if (decision.kind === 'noise') return skipped(visit.visitId);

      // The confidence gate guards *assignment to an existing Thread* — that is
      // the move a classifier gets quietly wrong and a person has to undo. A
      // proposed new Thread is created unconfirmed instead: it is visible,
      // labelled with its confidence, and one click to accept or discard.
      const uncertainAssignment =
        decision.kind === 'existing_thread' && decision.confidence < policy.autoAssignConfidence;

      if (decision.kind === 'review_required' || uncertainAssignment) {
        const review: ReviewItem = {
          schemaVersion: 1,
          reviewId: options.ids.next(),
          kind: 'classification',
          status: 'open',
          createdAt: now,
          resolvedAt: null,
          visitId: visit.visitId,
          candidates: candidates.slice(0, 5),
          suggestedThreadId: decision.threadId,
          confidence: decision.confidence,
          rationale: decision.rationale,
          provider: decision.provider,
        };
        return {
          visitId: visit.visitId,
          thread: null,
          membership: null,
          evidence: null,
          review,
          outcome: 'review_queued',
        };
      }

      const terms = termsOf(`${page.title} ${page.host}`, 16);

      if (decision.kind === 'new_thread') {
        const thread: Thread = {
          schemaVersion: 1,
          threadId: options.ids.next(),
          title: decision.proposedTitle ?? truncate(page.title, 80),
          intent: '',
          status: 'active',
          accent: ACCENTS[(options.threadCountHint?.() ?? 0) % ACCENTS.length] as ThreadAccent,
          keywords: terms,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: visit.endedAt ?? now,
          origin: 'auto',
          confirmed: false,
        };
        return {
          visitId: visit.visitId,
          thread,
          membership: membershipFor(options, visit, thread.threadId, decision, now),
          evidence: evidenceFor(options, visit, page, thread.threadId, true, now),
          review: null,
          outcome: 'created',
        };
      }

      const target = candidates.find((candidate) => candidate.threadId === decision.threadId);
      if (decision.threadId === null || target === undefined) return skipped(visit.visitId);

      const profiles = await options.store.candidateThreads({ limit: 200 });
      const existing = profiles.find((profile) => profile.thread.threadId === decision.threadId);
      if (existing === undefined) return skipped(visit.visitId);

      const lastActivityAt = visit.endedAt ?? now;
      const thread: Thread = {
        ...existing.thread,
        // Reactivation is a status change, not a new Thread.
        status: existing.thread.status === 'dormant' ? 'active' : existing.thread.status,
        keywords: dedupe([...existing.thread.keywords, ...terms]).slice(0, 48),
        updatedAt: now,
        lastActivityAt:
          fromTimestamp(lastActivityAt) > fromTimestamp(existing.thread.lastActivityAt)
            ? lastActivityAt
            : existing.thread.lastActivityAt,
      };

      return {
        visitId: visit.visitId,
        thread,
        membership: membershipFor(options, visit, thread.threadId, decision, now),
        evidence: evidenceFor(
          options,
          visit,
          page,
          thread.threadId,
          existing.confirmedPageIds.length === 0,
          now,
        ),
        review: null,
        outcome: 'assigned',
      };
    },
  };
}

function membershipFor(
  options: ThreadEngineOptions,
  visit: Visit,
  threadId: string,
  decision: { confidence: number; rationale: string[]; provider: { name: string; version: string } },
  now: string,
): ThreadMembership {
  return {
    schemaVersion: 1,
    membershipId: options.ids.next(),
    visitId: visit.visitId,
    threadId,
    revision: 1,
    state: 'proposed',
    confidence: decision.confidence,
    rationale: decision.rationale,
    provider: decision.provider,
    decidedAt: now,
    supersedesId: null,
    decidedBy: 'provider',
  };
}

function evidenceFor(
  options: ThreadEngineOptions,
  visit: Visit,
  page: Page,
  threadId: string,
  isFirstInThread: boolean,
  now: string,
): Evidence {
  return {
    schemaVersion: 1,
    evidenceId: options.ids.next(),
    threadId,
    visitId: visit.visitId,
    pageId: page.pageId,
    title: page.title,
    url: page.url,
    role: evidenceRoleFor(page, visit, isFirstInThread),
    excerpt: null,
    capturedAt: now,
  };
}
