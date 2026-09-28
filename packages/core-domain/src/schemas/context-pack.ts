import { z } from 'zod';
import { schemaVersionSchema, timestampSchema, uuidSchema } from './common.js';

/**
 * A ContextPack is the only shape that ever leaves the local plane toward an
 * agent. Two rules make it safe to hand over:
 *
 * 1. every factual item carries provenance or an explicit inference label;
 * 2. what was left out is reported, so silence is never mistaken for absence.
 */

export const contextProvenanceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('source'),
    evidenceId: uuidSchema,
    url: z.url(),
    title: z.string().max(512),
    capturedAt: timestampSchema,
    /** Page-derived text is quoted evidence, never instruction. */
    trust: z.literal('untrusted_source_content'),
  }),
  z.object({
    type: z.literal('human'),
    confirmedAt: timestampSchema,
  }),
  z.object({
    type: z.literal('inference'),
    /** Which adapter inferred it, so a reader can discount it. */
    by: z.string().max(64),
    note: z.string().max(200),
  }),
]);
export type ContextProvenance = z.infer<typeof contextProvenanceSchema>;

export const contextItemSchema = z.object({
  kind: z.enum(['intent', 'finding', 'question', 'checkpoint', 'source', 'timeline']),
  text: z.string().max(4000),
  provenance: contextProvenanceSchema,
  /** Rough token cost of this item, used for budget assembly. */
  estimatedTokens: z.number().int().min(0),
});
export type ContextItem = z.infer<typeof contextItemSchema>;

export const contextOmissionSchema = z.object({
  reason: z.enum([
    'token_budget',
    'scope_not_granted',
    'excluded_domain',
    'unconfirmed_proposal',
    'retention_expired',
    'detail_level',
  ]),
  count: z.number().int().min(0),
});
export type ContextOmission = z.infer<typeof contextOmissionSchema>;

export const contextDetailSchema = z.enum(['brief', 'evidence', 'full_trace']);
export type ContextDetail = z.infer<typeof contextDetailSchema>;

export const contextRequestSchema = z.object({
  /** What the agent is being asked to do. Drives ranking. */
  task: z.string().min(1).max(2000),
  threadIds: z.array(uuidSchema).min(1).max(8),
  tokenBudget: z.number().int().min(256).max(200_000),
  detail: contextDetailSchema,
  include: z.object({
    findings: z.boolean(),
    sourceExcerpts: z.boolean(),
    openQuestions: z.boolean(),
    rawActivity: z.boolean(),
  }),
});
export type ContextRequest = z.infer<typeof contextRequestSchema>;

export const contextPackSchema = z.object({
  schemaVersion: schemaVersionSchema,
  packId: uuidSchema,
  builtAt: timestampSchema,
  request: contextRequestSchema,
  threads: z.array(
    z.object({
      threadId: uuidSchema,
      title: z.string().max(200),
      status: z.string().max(32),
    }),
  ),
  items: z.array(contextItemSchema),
  omissions: z.array(contextOmissionSchema),
  estimatedTokens: z.number().int().min(0),
  /**
   * Assembly is deterministic for the same snapshot, policy, request, and
   * adapter versions. This stamp lets a reader reproduce the pack.
   */
  determinism: z.object({
    brokerVersion: z.string().max(32),
    policyVersion: z.string().max(32),
    snapshotAt: timestampSchema,
  }),
});
export type ContextPack = z.infer<typeof contextPackSchema>;

export const agentRunSchema = z.object({
  schemaVersion: schemaVersionSchema,
  runId: uuidSchema,
  /** Client identity as presented by the agent, never as self-asserted trust. */
  client: z.string().max(120),
  purpose: z.string().max(500),
  scopes: z.array(z.string().max(64)).max(16),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  threadIds: z.array(uuidSchema),
  itemsRead: z.number().int().min(0),
  omissionCount: z.number().int().min(0),
  outputBytes: z.number().int().min(0),
  proposalIds: z.array(uuidSchema),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
