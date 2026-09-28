import type { BrowserEvent, BrowserEventDraft, IngestReceipt } from './schemas/events.js';
import type { Visit, VisitFeatures } from './schemas/attention.js';
import type {
  Evidence,
  Thread,
  ThreadCandidate,
  ThreadDecision,
  ThreadMembership,
} from './schemas/thread.js';
import type { ReviewItem } from './schemas/knowledge.js';
import type { ContextPack, ContextRequest } from './schemas/context-pack.js';

/**
 * The seams the plan requires. Browser APIs, storage, models, and any future
 * cloud or MCP transport live behind these interfaces, which is what lets the
 * domain tests run with no Chrome, no network, and no model.
 */

export interface CaptureSink {
  ingest(events: BrowserEventDraft[]): Promise<IngestReceipt>;
}

export type CaptureDecision =
  | { readonly outcome: 'accept' }
  | { readonly outcome: 'redact'; readonly reason: string }
  | { readonly outcome: 'reject'; readonly reason: string };

export interface CaptureCandidate {
  readonly url: string;
  readonly title: string;
  readonly incognito: boolean;
}

export interface ContentPolicy {
  inspect(input: CaptureCandidate): CaptureDecision;
}

export interface CandidateRetriever {
  forVisit(visit: Visit, limit: number): Promise<ThreadCandidate[]>;
}

export interface DecisionProvider {
  readonly name: string;
  readonly version: string;
  choose(visit: VisitFeatures, candidates: ThreadCandidate[]): Promise<ThreadDecision>;
}

export interface ThreadUpdate {
  readonly visitId: string;
  readonly thread: Thread | null;
  readonly membership: ThreadMembership | null;
  readonly evidence: Evidence | null;
  readonly review: ReviewItem | null;
  readonly outcome: 'assigned' | 'created' | 'review_queued' | 'noise' | 'skipped';
}

export interface ThreadEngine {
  apply(visit: Visit): Promise<ThreadUpdate>;
}

export interface ContextBroker {
  build(request: ContextRequest): Promise<ContextPack>;
}

export interface AgentProposal {
  readonly threadId: string;
  readonly client: string;
  readonly kind: 'finding' | 'artifact';
  readonly text: string;
  readonly sourceRefs: readonly string[];
  readonly confidence: number | null;
}

export interface AgentWriteback {
  propose(input: AgentProposal): Promise<ReviewItem>;
}

/**
 * Durable append-only event log. `append` must persist before it resolves —
 * the MV3 service worker can be terminated at any instruction boundary, so an
 * acknowledgement that outruns the write is data loss.
 */
export interface EventLog {
  append(events: BrowserEvent[]): Promise<IngestReceipt>;
  since(timestamp: string, limit: number): Promise<BrowserEvent[]>;
  purgeBefore(timestamp: string): Promise<number>;
}
