import { z } from 'zod';
import { schemaVersionSchema, timestampSchema } from './common.js';

/**
 * Settings are part of the privacy contract, so they are a validated wire shape
 * rather than a loose object. Defaults are the strict end of every axis.
 */

export const retentionSchema = z.object({
  /** Raw interaction events. */
  rawEventDays: z.number().int().min(1).max(365),
  /** Visits that never became meaningful. */
  unpromotedVisitDays: z.number().int().min(1).max(365),
  /** Confirmed Evidence, Findings, Checkpoints: kept until the user deletes them. */
  keepConfirmedForever: z.literal(true),
});
export type RetentionSettings = z.infer<typeof retentionSchema>;

export const visitPolicySchema = z.object({
  /** Foreground time before a Visit counts as meaningful. */
  minForegroundMs: z.number().int().min(1000).max(600_000),
  /** Idle gap that closes an attention span. */
  idleTimeoutMs: z.number().int().min(5_000).max(1_800_000),
  /** Re-focusing the same page within this window continues the same Visit. */
  visitContinuationMs: z.number().int().min(0).max(3_600_000),
  /** Assignments at or above this confidence apply without asking. */
  autoAssignConfidence: z.number().min(0.5).max(1),
  /** Below this, the Visit is treated as noise rather than queued for review. */
  reviewFloorConfidence: z.number().min(0).max(0.9),
  /** A Thread with no activity for this long becomes dormant. */
  dormantAfterMs: z.number().int().min(3_600_000),
});
export type VisitPolicy = z.infer<typeof visitPolicySchema>;

export const settingsSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Master switch. When false, no event is recorded at all. */
  trackingEnabled: z.boolean(),
  /** Set by the popup's "pause for N minutes" control. */
  pausedUntil: timestampSchema.nullable(),
  /** User-added hosts, on top of the always-denied built-in list. */
  excludedDomains: z.array(z.string().min(1).max(255)).max(500),
  /** Opt-in: keep document-identifying query parameters in stored URLs. */
  keepDocumentQueryParams: z.boolean(),
  retention: retentionSchema,
  visitPolicy: visitPolicySchema,
  /** Which classification adapter is active. */
  decisionProvider: z.enum(['heuristic']),
  updatedAt: timestampSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_VISIT_POLICY: VisitPolicy = {
  minForegroundMs: 8_000,
  idleTimeoutMs: 90_000,
  visitContinuationMs: 300_000,
  autoAssignConfidence: 0.75,
  reviewFloorConfidence: 0.25,
  dormantAfterMs: 3 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_RETENTION: RetentionSettings = {
  rawEventDays: 30,
  unpromotedVisitDays: 30,
  keepConfirmedForever: true,
};

export function defaultSettings(updatedAt: string): Settings {
  return {
    schemaVersion: 1,
    trackingEnabled: true,
    pausedUntil: null,
    excludedDomains: [],
    keepDocumentQueryParams: false,
    retention: DEFAULT_RETENTION,
    visitPolicy: DEFAULT_VISIT_POLICY,
    decisionProvider: 'heuristic',
    updatedAt,
  };
}
