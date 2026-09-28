/**
 * @jevtabs/thread-engine — candidate retrieval, decisions, and assignment.
 *
 * The DecisionProvider seam is the whole point of this package: the heuristic
 * adapter here is the offline fallback and the oracle, and any future model
 * adapter plugs in behind the same interface without the domain learning
 * anything about it.
 */

export * from './store.js';
export * from './features.js';
export * from './retriever.js';
export * from './heuristic-provider.js';
export * from './thread-engine.js';
export * from './corrections.js';
