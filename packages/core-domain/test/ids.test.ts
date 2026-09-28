import { describe, expect, it } from 'vitest';
import {
  createIdGenerator,
  estimateTokens,
  fixedClock,
  fromTimestamp,
  isTimestamp,
  isUuid,
  seededRandom,
  stableId,
  termOverlap,
  termsOf,
  toTimestamp,
  uuidV7Timestamp,
} from '@jevtabs/core-domain';

describe('createIdGenerator', () => {
  it('produces well-formed, time-ordered v7 uuids', () => {
    const clock = fixedClock(Date.parse('2026-01-02T03:04:05.006Z'));
    const ids = createIdGenerator(clock, seededRandom(1));
    const first = ids.next();
    clock.advance(5);
    const second = ids.next();

    expect(isUuid(first)).toBe(true);
    expect(first[14]).toBe('7');
    expect(second > first).toBe(true);
    expect(uuidV7Timestamp(first)).toBe(Date.parse('2026-01-02T03:04:05.006Z'));
  });

  it('stays strictly increasing inside a single millisecond', () => {
    const ids = createIdGenerator(fixedClock(1_700_000_000_000), seededRandom(7));
    const batch = Array.from({ length: 50 }, () => ids.next());
    expect([...batch].sort()).toEqual(batch);
    expect(new Set(batch).size).toBe(50);
  });

  it('is reproducible for a given clock and seed', () => {
    const make = () => createIdGenerator(fixedClock(42_000), seededRandom(9)).next();
    expect(make()).toBe(make());
  });
});

describe('stableId', () => {
  it('is namespaced and deterministic', () => {
    expect(stableId('page', 'x')).toBe(stableId('page', 'x'));
    expect(stableId('page', 'x')).not.toBe(stableId('thread', 'x'));
  });
});

describe('timestamps', () => {
  it('round-trips through RFC 3339 UTC', () => {
    const ms = Date.parse('2026-09-18T09:12:00.000Z');
    expect(toTimestamp(ms)).toBe('2026-09-18T09:12:00.000Z');
    expect(fromTimestamp(toTimestamp(ms))).toBe(ms);
    expect(isTimestamp(toTimestamp(ms))).toBe(true);
    expect(isTimestamp('2026-09-18T09:12:00Z')).toBe(false);
  });
});

describe('text utilities', () => {
  it('drops stopwords and keeps meaningful terms', () => {
    expect(termsOf('Introducing System One Models & Jev')).toEqual([
      'introducing',
      'system',
      'one',
      'models',
      'jev',
    ]);
  });

  it('bigrams CJK so titles are comparable without a segmenter', () => {
    expect(termsOf('北京家庭旅行')).toContain('北京');
  });

  it('scores overlap symmetrically for equal-size sets', () => {
    expect(termOverlap(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(termOverlap(['a', 'b'], ['c'])).toBe(0);
    expect(termOverlap([], ['a'])).toBe(0);
  });

  it('estimates more tokens for CJK than for Latin of the same length', () => {
    expect(estimateTokens('北京家庭旅行')).toBeGreaterThan(estimateTokens('abcdef'));
  });
});
