import { z } from 'zod';
import { schemaVersionSchema, stableIdSchema, timestampSchema, uuidSchema } from './common.js';

/**
 * BrowserEvents are the immutable tape JevTabs replays. They describe *that*
 * attention moved, never *what* was typed. There is deliberately no field for
 * page body, form values, headers, or cookies: adding one would be a change to
 * the privacy contract, not an implementation detail.
 */

/** Stable within a browser profile: `${windowId}:${tabId}`. */
export const tabKeySchema = z.string().regex(/^\d+:\d+$/, 'expected windowId:tabId');

/** How the browser says navigation happened. Coarse on purpose. */
export const navigationCauseSchema = z.enum([
  'link',
  'typed',
  'form_submit',
  'reload',
  'back_forward',
  'generated',
  'auto_subframe',
  'other',
]);

/** Coarse interaction signals. No coordinates, no keys, no selected text. */
export const interactionKindSchema = z.enum(['scroll', 'selection', 'copy', 'media_playback']);

const baseEvent = {
  schemaVersion: schemaVersionSchema,
  eventId: uuidSchema,
  /** When the browser observed it. */
  occurredAt: timestampSchema,
  /** When JevTabs durably stored it. Differs after a service-worker restart. */
  recordedAt: timestampSchema,
  /** Survives service-worker termination; changes only on browser restart. */
  captureSessionId: uuidSchema,
};

export const browserEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseEvent,
    type: z.literal('navigation_committed'),
    tabKey: tabKeySchema,
    pageId: stableIdSchema,
    url: z.url(),
    title: z.string().max(512),
    cause: navigationCauseSchema,
    /** Page the user came from, when the browser attributes one. */
    referrerPageId: stableIdSchema.nullable(),
  }),
  z.object({
    ...baseEvent,
    type: z.literal('tab_activated'),
    tabKey: tabKeySchema,
    pageId: stableIdSchema.nullable(),
  }),
  z.object({
    ...baseEvent,
    type: z.literal('tab_closed'),
    tabKey: tabKeySchema,
  }),
  z.object({
    ...baseEvent,
    type: z.literal('window_focus_changed'),
    /** `null` when focus left the browser entirely. */
    tabKey: tabKeySchema.nullable(),
    focused: z.boolean(),
  }),
  z.object({
    ...baseEvent,
    type: z.literal('idle_state_changed'),
    state: z.enum(['active', 'idle', 'locked']),
  }),
  z.object({
    ...baseEvent,
    type: z.literal('interaction'),
    tabKey: tabKeySchema,
    pageId: stableIdSchema,
    kind: interactionKindSchema,
  }),
  z.object({
    ...baseEvent,
    type: z.literal('tracking_changed'),
    enabled: z.boolean(),
    reason: z.enum(['user', 'incognito', 'excluded_domain', 'startup']),
  }),
]);

export type BrowserEvent = z.infer<typeof browserEventSchema>;
export type BrowserEventType = BrowserEvent['type'];
export type NavigationCause = z.infer<typeof navigationCauseSchema>;
export type InteractionKind = z.infer<typeof interactionKindSchema>;

/**
 * What the extension hands to the ingest boundary before ids and timestamps are
 * assigned. Keeping this separate is what lets tests inject clocks and ids.
 */
export type BrowserEventDraft = {
  [K in BrowserEventType]: Omit<
    Extract<BrowserEvent, { type: K }>,
    'schemaVersion' | 'eventId' | 'recordedAt' | 'captureSessionId'
  >;
}[BrowserEventType];

export const ingestReceiptSchema = z.object({
  /** Events durably stored by this call. */
  accepted: z.array(uuidSchema),
  /** Events already present — replay is a no-op, never a duplicate. */
  duplicates: z.array(uuidSchema),
  /** Events the content policy refused, with a machine-readable reason. */
  rejected: z.array(z.object({ eventId: uuidSchema, reason: z.string() })),
  /**
   * Low-value events the bounded outbox had to drop. Surfaced in the UI rather
   * than swallowed, so loss is always visible.
   */
  droppedForCapacity: z.number().int().min(0),
});
export type IngestReceipt = z.infer<typeof ingestReceiptSchema>;
