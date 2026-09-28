/**
 * Time is injected everywhere in JevTabs so that capture, sessionization, and
 * retention are deterministic under test. Nothing in the domain may call
 * `Date.now()` directly.
 */

/** Milliseconds since the Unix epoch. */
export type EpochMs = number;

/** An RFC 3339 timestamp, always normalized to UTC with millisecond precision. */
export type Timestamp = string;

export interface Clock {
  now(): EpochMs;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A clock that only moves when the test tells it to. */
export function fixedClock(startMs: EpochMs): Clock & {
  advance(ms: number): void;
  set(ms: EpochMs): void;
} {
  let current = startMs;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
    set(ms: EpochMs) {
      current = ms;
    },
  };
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function toTimestamp(ms: EpochMs): Timestamp {
  return new Date(ms).toISOString();
}

export function fromTimestamp(value: Timestamp): EpochMs {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`Not an RFC 3339 timestamp: ${value}`);
  }
  return ms;
}

export function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'string' && RFC3339_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
