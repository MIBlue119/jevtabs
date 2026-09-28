import { describe, expect, it } from 'vitest';
import type { ThreadMembership } from '@jevtabs/core-domain';
import {
  confirmMembership,
  correctMembership,
  currentMembership,
  withdrawMembership,
} from '@jevtabs/thread-engine';
import { createHarness } from '@jevtabs/test-fixtures';

const harness = createHarness();

const proposed: ThreadMembership = {
  schemaVersion: 1,
  membershipId: '01930000-0000-7000-8000-0000000ad001',
  visitId: '01930000-0000-7000-8000-00000000a001',
  threadId: '01930000-0000-7000-8000-0000000ad002',
  revision: 1,
  state: 'proposed',
  confidence: 0.62,
  rationale: ['title overlap'],
  provider: { name: 'heuristic', version: '1.0.0' },
  decidedAt: '2026-09-18T09:30:00.000Z',
  supersedesId: null,
  decidedBy: 'provider',
};

describe('corrections', () => {
  it('records a correction as a new revision instead of overwriting history', () => {
    const result = correctMembership(harness, proposed, proposed.visitId, 'other-thread');

    expect(result.previous?.state).toBe('corrected');
    expect(result.previous?.membershipId).toBe(proposed.membershipId);
    expect(result.next?.revision).toBe(2);
    expect(result.next?.supersedesId).toBe(proposed.membershipId);
    expect(result.next?.decidedBy).toBe('human');
    expect(result.next?.confidence).toBe(1);
  });

  it('keeps the original provider stamp so accuracy stays measurable', () => {
    const result = correctMembership(harness, proposed, proposed.visitId, 'other-thread');
    expect(result.next?.provider).toEqual(proposed.provider);
  });

  it('marks a confirmation as human-decided without changing the thread', () => {
    const result = confirmMembership(harness, proposed);
    expect(result.next?.state).toBe('confirmed');
    expect(result.next?.threadId).toBe(proposed.threadId);
    expect(result.next?.decidedBy).toBe('human');
  });

  it('withdraws a Visit from every Thread without deleting it', () => {
    const result = withdrawMembership(harness, proposed);
    expect(result.next).toBeNull();
    expect(result.previous?.state).toBe('withdrawn');
  });

  it('resolves the assignment in force as the highest live revision', () => {
    const corrected = correctMembership(harness, proposed, proposed.visitId, 'other-thread');
    const history = [corrected.previous, corrected.next].filter(
      (row): row is ThreadMembership => row !== null,
    );
    expect(currentMembership(history)?.threadId).toBe('other-thread');
    expect(currentMembership([{ ...proposed, state: 'withdrawn' }])).toBeNull();
    expect(currentMembership([])).toBeNull();
  });
});
