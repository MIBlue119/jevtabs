/**
 * @jevtabs/capture-engine — the observation side of the local plane.
 *
 * Content policy, the ingest boundary, and Visit construction. This package
 * decides what may be recorded and turns a raw event tape into intervals of
 * meaningful foreground attention. It never touches storage or browser APIs
 * directly; both arrive as injected ports.
 */

export * from './deny-rules.js';
export * from './content-policy.js';
export * from './visit-builder.js';
export * from './ingest.js';
