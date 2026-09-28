import {
  type Clock,
  type IdGenerator,
  type ThreadMembership,
  toTimestamp,
} from '@jevtabs/core-domain';

/**
 * Corrections.
 *
 * A person changing an assignment is the most valuable signal the system ever
 * receives, so it is recorded as an append-only revision: the previous
 * membership is marked `corrected` and kept, and a new confirmed revision
 * supersedes it. Nothing is overwritten, which is what makes it possible to
 * measure how often the classifier was wrong and about what.
 */

export interface CorrectionContext {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface CorrectionResult {
  /** The superseded row, to be written back with its new state. */
  readonly previous: ThreadMembership | null;
  /** The new current assignment, or null when the Visit was marked as noise. */
  readonly next: ThreadMembership | null;
}

/** Confirms the provider's proposal as-is. */
export function confirmMembership(
  context: CorrectionContext,
  current: ThreadMembership,
): CorrectionResult {
  return {
    previous: null,
    next: {
      ...current,
      state: 'confirmed',
      decidedBy: 'human',
      decidedAt: toTimestamp(context.clock.now()),
    },
  };
}

/** Moves a Visit to a different Thread. */
export function correctMembership(
  context: CorrectionContext,
  current: ThreadMembership | null,
  visitId: string,
  threadId: string,
): CorrectionResult {
  const now = toTimestamp(context.clock.now());
  return {
    previous: current === null ? null : { ...current, state: 'corrected' },
    next: {
      schemaVersion: 1,
      membershipId: context.ids.next(),
      visitId,
      threadId,
      revision: (current?.revision ?? 0) + 1,
      state: 'confirmed',
      confidence: 1,
      rationale: ['人工更正 · corrected by you'],
      provider: current?.provider ?? { name: 'human', version: '1' },
      decidedAt: now,
      supersedesId: current?.membershipId ?? null,
      decidedBy: 'human',
    },
  };
}

/** Removes a Visit from every Thread without deleting the Visit itself. */
export function withdrawMembership(
  context: CorrectionContext,
  current: ThreadMembership,
): CorrectionResult {
  return {
    previous: {
      ...current,
      state: 'withdrawn',
      decidedBy: 'human',
      decidedAt: toTimestamp(context.clock.now()),
    },
    next: null,
  };
}

/** The assignment in force for a Visit: highest revision that still stands. */
export function currentMembership(
  memberships: readonly ThreadMembership[],
): ThreadMembership | null {
  const live = memberships.filter(
    (membership) => membership.state === 'proposed' || membership.state === 'confirmed',
  );
  if (live.length === 0) return null;
  return live.reduce((best, membership) =>
    membership.revision > best.revision ? membership : best,
  );
}
