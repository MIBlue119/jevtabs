/**
 * @jevtabs/core-domain — the domain model, wire contracts, and pure invariants.
 *
 * Nothing here may import a browser API, a storage engine, a model adapter, or
 * a network client. If a type from a vendor package would appear in this
 * package's public surface, it belongs in an adapter instead.
 */

export * from './time.js';
export * from './ids.js';
export * from './url.js';
export * from './text.js';
export * from './ports.js';

export * from './schemas/common.js';
export * from './schemas/events.js';
export * from './schemas/attention.js';
export * from './schemas/thread.js';
export * from './schemas/knowledge.js';
export * from './schemas/context-pack.js';
export * from './schemas/settings.js';
