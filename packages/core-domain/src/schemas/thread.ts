import { z } from 'zod';
import {
  confidenceSchema,
  providerStampSchema,
  schemaVersionSchema,
  stableIdSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

/** A Thread is the durable unit of intent: it outlives tabs, sessions, and days. */

export const threadStatusSchema = z.enum(['active', 'dormant', 'paused', 'completed', 'archived']);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

/** Matches the accent set used by the workspace UI. */
export const threadAccentSchema = z.enum(['green', 'blue', 'violet', 'amber', 'gray']);
export type ThreadAccent = z.infer<typeof threadAccentSchema>;

export const threadSchema = z.object({
  schemaVersion: schemaVersionSchema,
  threadId: uuidSchema,
  title: z.string().min(1).max(200),
  /** What the person was trying to answer. Editable; never silently rewritten. */
  intent: z.string().max(2000),
  status: threadStatusSchema,
  accent: threadAccentSchema,
  /** Lexical profile used for candidate retrieval. */
  keywords: z.array(z.string().min(1).max(64)).max(64),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastActivityAt: timestampSchema,
  /** `auto` threads were proposed by a provider; `human` ones were created by hand. */
  origin: z.enum(['auto', 'human']),
  /** True once a human has accepted the Thread's existence. */
  confirmed: z.boolean(),
});
export type Thread = z.infer<typeof threadSchema>;

/**
 * Visit-to-Thread assignment. Append-only: a correction adds a revision that
 * supersedes the previous one; raw history is never rewritten.
 */
export const threadMembershipSchema = z.object({
  schemaVersion: schemaVersionSchema,
  membershipId: uuidSchema,
  visitId: uuidSchema,
  threadId: uuidSchema,
  /** Monotonic per visit, starting at 1. */
  revision: z.number().int().min(1),
  state: z.enum(['proposed', 'confirmed', 'corrected', 'withdrawn']),
  confidence: confidenceSchema,
  /** Short machine-generated reasons, shown verbatim in the UI. */
  rationale: z.array(z.string().max(120)).max(8),
  provider: providerStampSchema,
  decidedAt: timestampSchema,
  /** The membership this one replaces, when it is a correction. */
  supersedesId: uuidSchema.nullable(),
  /** `human` marks a correction the classifier must learn from. */
  decidedBy: z.enum(['provider', 'human']),
});
export type ThreadMembership = z.infer<typeof threadMembershipSchema>;

/** A candidate Thread offered to a DecisionProvider. */
export const threadCandidateSchema = z.object({
  threadId: uuidSchema,
  title: z.string(),
  summary: z.string().max(400),
  keywords: z.array(z.string()),
  lastActivityAt: timestampSchema,
  status: threadStatusSchema,
  /** Retrieval score components, kept separate so the UI can explain them. */
  signals: z.object({
    lexical: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    navigation: z.number().min(0).max(1),
    priorCorrections: z.number().min(0).max(1),
  }),
  score: z.number().min(0).max(1),
});
export type ThreadCandidate = z.infer<typeof threadCandidateSchema>;

/** What a DecisionProvider returns. Validated before it is trusted. */
export const threadDecisionSchema = z.object({
  kind: z.enum(['existing_thread', 'new_thread', 'noise', 'review_required']),
  /** Required when `kind === 'existing_thread'`. */
  threadId: uuidSchema.nullable(),
  /** Suggested title when `kind === 'new_thread'`. */
  proposedTitle: z.string().max(200).nullable(),
  confidence: confidenceSchema,
  rationale: z.array(z.string().max(120)).max(8),
  provider: providerStampSchema,
});
export type ThreadDecision = z.infer<typeof threadDecisionSchema>;

export const evidenceRoleSchema = z.enum([
  'primary',
  'implementation',
  'evidence',
  'reference',
  'search',
]);
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;

export const evidenceSchema = z.object({
  schemaVersion: schemaVersionSchema,
  evidenceId: uuidSchema,
  threadId: uuidSchema,
  visitId: uuidSchema,
  pageId: stableIdSchema,
  title: z.string().max(512),
  url: z.url(),
  role: evidenceRoleSchema,
  /**
   * A short user-selected quote. Only ever populated by an explicit save
   * action; JevTabs does not scrape page bodies on its own.
   */
  excerpt: z.string().max(2000).nullable(),
  capturedAt: timestampSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
