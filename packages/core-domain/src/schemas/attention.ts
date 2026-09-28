import { z } from 'zod';
import {
  schemaVersionSchema,
  stableIdSchema,
  timestampSchema,
  trustLabelSchema,
  uuidSchema,
} from './common.js';
import { navigationCauseSchema } from './events.js';

/**
 * Page, AttentionSpan, and Visit.
 *
 * A tab is an ephemeral container. The Visit — one interval of meaningful
 * foreground attention on one Page — is the unit JevTabs classifies.
 */

export const pageSchema = z.object({
  schemaVersion: schemaVersionSchema,
  pageId: stableIdSchema,
  /** Normalized href: no fragment, no query unless allowlisted, no credentials. */
  url: z.url(),
  host: z.string().min(1).max(255),
  rootDomain: z.string().min(1).max(255),
  title: z.string().max(512),
  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
  /** Page-derived text is always quoted, never instruction. */
  trust: trustLabelSchema,
});
export type Page = z.infer<typeof pageSchema>;

export const attentionSpanSchema = z.object({
  startedAt: timestampSchema,
  endedAt: timestampSchema,
  /** Why the span closed — useful for debugging sessionization. */
  closedBy: z.enum(['blur', 'tab_switch', 'navigation', 'idle', 'tab_closed', 'shutdown']),
});
export type AttentionSpan = z.infer<typeof attentionSpanSchema>;

export const visitSignalsSchema = z.object({
  scrolled: z.boolean(),
  selected: z.boolean(),
  copied: z.boolean(),
  mediaPlayback: z.boolean(),
  /** How many times the user came back to this Visit's tab. */
  activationCount: z.number().int().min(1),
  cause: navigationCauseSchema,
  /** The Page the user navigated from, when known. */
  referrerPageId: stableIdSchema.nullable(),
});
export type VisitSignals = z.infer<typeof visitSignalsSchema>;

export const visitSchema = z.object({
  schemaVersion: schemaVersionSchema,
  visitId: uuidSchema,
  pageId: stableIdSchema,
  tabKey: z.string(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  /** Sum of the attention spans. Background time is never counted. */
  foregroundMs: z.number().int().min(0),
  spans: z.array(attentionSpanSchema),
  signals: visitSignalsSchema,
  status: z.enum(['open', 'closed']),
  /**
   * Whether this Visit crossed the meaningfulness threshold. Visits below it
   * are kept as history but never classified and never shown as work.
   */
  meaningful: z.boolean(),
  captureSessionId: uuidSchema,
});
export type Visit = z.infer<typeof visitSchema>;

/**
 * The minimized view a DecisionProvider sees. Deliberately narrow: a remote
 * provider must be able to classify from this without receiving page bodies.
 */
export const visitFeaturesSchema = z.object({
  visitId: uuidSchema,
  pageId: stableIdSchema,
  host: z.string(),
  path: z.string(),
  title: z.string().max(512),
  /** Tokenized title and path terms. */
  terms: z.array(z.string()),
  startedAt: timestampSchema,
  foregroundMs: z.number().int().min(0),
  activationCount: z.number().int().min(1),
  signals: z.object({
    scrolled: z.boolean(),
    selected: z.boolean(),
    copied: z.boolean(),
  }),
  cause: navigationCauseSchema,
  referrerThreadIds: z.array(uuidSchema),
});
export type VisitFeatures = z.infer<typeof visitFeaturesSchema>;
