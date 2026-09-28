import { z } from 'zod';

/** Bumped whenever a stored or exported shape changes incompatibly. */
export const SCHEMA_VERSION = 1;

export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'expected a uuid');

export const stableIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'expected a content-addressed id');

export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'expected an RFC 3339 UTC timestamp');

export const schemaVersionSchema = z.literal(SCHEMA_VERSION);

/**
 * Every piece of text that originated inside a web page carries this marker.
 * Consumers — the UI, exports, and any future model or agent adapter — must
 * present it as quoted evidence. Page text can never authorize an action.
 */
export const TRUST_UNTRUSTED_SOURCE = 'untrusted_source_content' as const;
export const trustLabelSchema = z.literal(TRUST_UNTRUSTED_SOURCE);

export const provenanceSchema = z.enum(['human', 'imported', 'inferred', 'agent_proposed']);
export type Provenance = z.infer<typeof provenanceSchema>;

export const providerStampSchema = z.object({
  /** Adapter name, e.g. `heuristic` or `jev`. */
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
});
export type ProviderStamp = z.infer<typeof providerStampSchema>;

export const confidenceSchema = z.number().min(0).max(1);
