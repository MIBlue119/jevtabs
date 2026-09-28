import { createIdGenerator, systemClock, type Clock, type IdGenerator } from '@jevtabs/core-domain';
import { KV_KEYS, db, readKv, writeKv } from '../storage/db.js';
import { CapturePipeline } from './pipeline.js';

/**
 * Service-worker session state.
 *
 * MV3 terminates the worker aggressively — after thirty seconds of inactivity,
 * at the browser's discretion, in the middle of anything. So nothing here is
 * allowed to live only in memory: the capture session id is persisted, and a
 * cold start reconciles against what is already durable rather than assuming
 * it is the first run.
 */

export interface Session {
  readonly pipeline: CapturePipeline;
  readonly captureSessionId: string;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

interface StoredSession {
  readonly captureSessionId: string;
  /** Distinguishes "worker restarted" from "browser restarted". */
  readonly startedAt: string;
}

let cached: Promise<Session> | null = null;

/**
 * A browser restart begins a new capture session; a worker restart continues
 * the old one. `chrome.runtime.onStartup` is the only reliable signal for the
 * former, so the caller passes `forceNew` when it fires.
 */
export function getSession(forceNew = false): Promise<Session> {
  if (forceNew) cached = null;
  cached ??= build(forceNew);
  return cached;
}

async function build(forceNew: boolean): Promise<Session> {
  const clock = systemClock;
  const ids = createIdGenerator(clock);
  const database = db();

  const stored = await readKv<StoredSession>(database, KV_KEYS.captureSession);
  let captureSessionId = stored?.captureSessionId;

  if (forceNew || captureSessionId === undefined) {
    captureSessionId = ids.next();
    await writeKv(database, KV_KEYS.captureSession, {
      captureSessionId,
      startedAt: new Date(clock.now()).toISOString(),
    } satisfies StoredSession);
  }

  const pipeline = new CapturePipeline({ database, clock, ids, captureSessionId });
  return { pipeline, captureSessionId, clock, ids };
}

/** Test seam. */
export function resetSession(): void {
  cached = null;
}
