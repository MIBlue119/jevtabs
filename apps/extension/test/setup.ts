/**
 * IndexedDB is not a Node global, so the storage layer runs against
 * `fake-indexeddb`. This is the same code path the extension uses in Chrome —
 * only the engine underneath differs.
 */
import 'fake-indexeddb/auto';
