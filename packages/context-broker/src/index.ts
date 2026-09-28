/**
 * @jevtabs/context-broker — scoped, cited, token-bounded agent handoff.
 *
 * Local only. There is no transport here: the broker assembles a pack and
 * renders it, and the person decides where it goes. An MCP server, when it
 * arrives, becomes one more caller of this same deterministic function.
 */

export * from './store.js';
export * from './broker.js';
export * from './render.js';
