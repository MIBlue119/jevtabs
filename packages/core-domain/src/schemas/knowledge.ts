import { z } from 'zod';
import {
  confidenceSchema,
  provenanceSchema,
  providerStampSchema,
  schemaVersionSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';
import { threadCandidateSchema } from './thread.js';

/** Findings, Checkpoints, ReviewItems, Artifacts — the durable knowledge layer. */

export const findingSchema = z.object({
  schemaVersion: schemaVersionSchema,
  findingId: uuidSchema,
  threadId: uuidSchema,
  revision: z.number().int().min(1),
  text: z.string().min(1).max(500),
  detail: z.string().max(4000),
  provenance: provenanceSchema,
  /**
   * `proposed` findings — including everything an agent contributes — are
   * inert until a human confirms them. Agents may not confirm their own work.
   */
  state: z.enum(['proposed', 'confirmed', 'rejected']),
  /** Evidence ids backing the claim. Empty means the claim is an inference. */
  sourceRefs: z.array(uuidSchema).max(32),
  confidence: confidenceSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /** Human handle or agent client id. */
  author: z.string().max(120),
  supersedesId: uuidSchema.nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

export const checkpointSchema = z.object({
  schemaVersion: schemaVersionSchema,
  checkpointId: uuidSchema,
  threadId: uuidSchema,
  title: z.string().min(1).max(200),
  intent: z.string().max(2000),
  /** Evidence ids that mattered most at the moment of stopping. */
  keySources: z.array(uuidSchema).max(32),
  /** Finding ids that were settled. */
  settledFindings: z.array(uuidSchema).max(32),
  openQuestions: z.array(z.string().max(300)).max(16),
  nextAction: z.string().max(500),
  createdAt: timestampSchema,
  /** Whether creating this checkpoint also paused the Thread. */
  pausedThread: z.boolean(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

export const reviewItemSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: schemaVersionSchema,
    reviewId: uuidSchema,
    kind: z.literal('classification'),
    status: z.enum(['open', 'resolved', 'dismissed']),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    visitId: uuidSchema,
    candidates: z.array(threadCandidateSchema).max(5),
    /** What the provider would have picked, and how sure it was. */
    suggestedThreadId: uuidSchema.nullable(),
    confidence: confidenceSchema,
    rationale: z.array(z.string().max(120)).max(8),
    provider: providerStampSchema,
  }),
  z.object({
    schemaVersion: schemaVersionSchema,
    reviewId: uuidSchema,
    kind: z.literal('reactivation'),
    status: z.enum(['open', 'resolved', 'dismissed']),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    visitId: uuidSchema,
    threadId: uuidSchema,
    dormantSinceAt: timestampSchema,
    confidence: confidenceSchema,
    rationale: z.array(z.string().max(120)).max(8),
  }),
  z.object({
    schemaVersion: schemaVersionSchema,
    reviewId: uuidSchema,
    kind: z.literal('agent_proposal'),
    status: z.enum(['open', 'resolved', 'dismissed']),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    threadId: uuidSchema,
    /** Finding or Artifact awaiting a human decision. */
    subjectId: uuidSchema,
    subjectKind: z.enum(['finding', 'artifact']),
    agentRunId: uuidSchema,
  }),
]);
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const artifactSchema = z.object({
  schemaVersion: schemaVersionSchema,
  artifactId: uuidSchema,
  threadId: uuidSchema,
  uri: z.string().min(1).max(2048),
  kind: z.enum(['document', 'code', 'issue', 'note', 'other']),
  summary: z.string().max(1000),
  createdAt: timestampSchema,
  author: z.string().max(120),
  state: z.enum(['proposed', 'confirmed', 'rejected']),
});
export type Artifact = z.infer<typeof artifactSchema>;

/** A tombstone proves a deletion happened without keeping the deleted content. */
export const tombstoneSchema = z.object({
  schemaVersion: schemaVersionSchema,
  tombstoneId: uuidSchema,
  entity: z.enum(['visit', 'page', 'thread', 'evidence', 'finding', 'checkpoint', 'event']),
  entityId: z.string(),
  deletedAt: timestampSchema,
  reason: z.enum(['user', 'retention', 'exclusion']),
});
export type Tombstone = z.infer<typeof tombstoneSchema>;
