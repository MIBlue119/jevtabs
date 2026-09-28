import {
  type AttentionSpan,
  type BrowserEvent,
  type Visit,
  type VisitPolicy,
  type VisitSignals,
  DEFAULT_VISIT_POLICY,
  deterministicUuid,
  fromTimestamp,
  toTimestamp,
  type NavigationCause,
} from '@jevtabs/core-domain';

/**
 * Sessionization.
 *
 * The rule that shapes everything here: a Visit exists only where foreground
 * attention existed. A tab that loaded in the background, or that has been
 * sitting open for sixteen days, produces no Visit and no foreground time —
 * which is what makes "you have 40 tabs open" stop being noise.
 *
 * This module is a pure reducer over a JSON-serializable state. The MV3
 * service worker can be terminated between any two events; the extension
 * persists the state after each batch and resumes from it, so termination
 * costs at most the in-flight batch and never produces a duplicate Visit.
 */

export const VISIT_BUILDER_STATE_VERSION = 1;

interface TabState {
  readonly pageId: string;
  readonly cause: NavigationCause;
  readonly referrerPageId: string | null;
}

interface OpenVisitState {
  visitId: string;
  pageId: string;
  tabKey: string;
  startedAt: string;
  spans: AttentionSpan[];
  /** Timestamp the current foreground span opened, or null when backgrounded. */
  spanStartedAt: string | null;
  signals: VisitSignals;
  captureSessionId: string;
}

export interface VisitBuilderState {
  readonly stateVersion: number;
  tabs: Record<string, TabState>;
  open: Record<string, OpenVisitState>;
  /**
   * `${tabKey}|${pageId}` → a Visit that was closed but may still be resumed.
   * The whole state is parked, not just the id, so resuming preserves the
   * spans already accumulated instead of restarting the clock.
   */
  parked: Record<string, { endedAt: string; visit: OpenVisitState }>;
  focusedTab: string | null;
  browserFocused: boolean;
  idle: 'active' | 'idle' | 'locked';
  /** Last moment we have positive evidence the person was present. */
  lastActivityAt: string | null;
  trackingEnabled: boolean;
}

export function initialVisitBuilderState(): VisitBuilderState {
  return {
    stateVersion: VISIT_BUILDER_STATE_VERSION,
    tabs: {},
    open: {},
    parked: {},
    focusedTab: null,
    browserFocused: true,
    idle: 'active',
    lastActivityAt: null,
    trackingEnabled: true,
  };
}

export interface VisitBuilderOptions {
  readonly policy?: VisitPolicy;
}

export interface ApplyResult {
  readonly state: VisitBuilderState;
  /**
   * Full snapshots of every Visit this event touched. Callers `put` them by
   * `visitId`, so replaying the same event stream converges on the same rows.
   */
  readonly visits: Visit[];
}

function emptySignals(
  cause: VisitSignals['cause'],
  referrerPageId: string | null,
  activationCount: number,
): VisitSignals {
  return {
    scrolled: false,
    selected: false,
    copied: false,
    mediaPlayback: false,
    activationCount,
    cause,
    referrerPageId,
  };
}

export class VisitBuilder {
  private readonly policy: VisitPolicy;

  constructor(options: VisitBuilderOptions = {}) {
    this.policy = options.policy ?? DEFAULT_VISIT_POLICY;
  }

  /** Materializes an open or closed Visit into its stored shape. */
  snapshot(open: OpenVisitState, at: string, status: 'open' | 'closed'): Visit {
    const spans = open.spans;
    const foregroundMs = spans.reduce(
      (total, span) =>
        total + Math.max(0, fromTimestamp(span.endedAt) - fromTimestamp(span.startedAt)),
      0,
    );
    const lastSpan = spans.at(-1);
    return {
      schemaVersion: 1,
      visitId: open.visitId,
      pageId: open.pageId,
      tabKey: open.tabKey,
      startedAt: open.startedAt,
      endedAt: status === 'closed' ? (lastSpan?.endedAt ?? at) : null,
      foregroundMs,
      spans,
      signals: open.signals,
      status,
      meaningful: this.isMeaningful(foregroundMs, open.signals),
      captureSessionId: open.captureSessionId,
    };
  }

  isMeaningful(foregroundMs: number, signals: VisitSignals): boolean {
    if (signals.copied || signals.selected) return true;
    if (foregroundMs >= this.policy.minForegroundMs) return true;
    // Repeatedly coming back to a page is itself a signal of intent.
    return signals.activationCount >= 3 && foregroundMs >= this.policy.minForegroundMs / 2;
  }

  /**
   * Closes the currently open foreground span, capping it so that walking away
   * from the machine cannot inflate attention time.
   */
  private closeSpan(
    open: OpenVisitState,
    at: string,
    closedBy: AttentionSpan['closedBy'],
    lastActivityAt: string | null,
  ): void {
    if (open.spanStartedAt === null) return;
    const startedMs = fromTimestamp(open.spanStartedAt);
    const capMs =
      (lastActivityAt === null ? startedMs : fromTimestamp(lastActivityAt)) +
      this.policy.idleTimeoutMs;
    const endedMs = Math.min(fromTimestamp(at), capMs);
    open.spanStartedAt = null;
    if (endedMs <= startedMs) return;
    open.spans.push({ startedAt: toTimestamp(startedMs), endedAt: toTimestamp(endedMs), closedBy });
  }

  private openSpan(open: OpenVisitState, at: string): void {
    if (open.spanStartedAt !== null) return;
    open.spanStartedAt = at;
  }

  private canFocus(state: VisitBuilderState): boolean {
    return state.trackingEnabled && state.browserFocused && state.idle === 'active';
  }

  /**
   * Starts — or continues — the Visit for `tabKey`. Returning to the same page
   * in the same tab within the continuation window resumes the existing Visit
   * instead of fragmenting one session into a dozen rows.
   */
  private ensureVisit(
    state: VisitBuilderState,
    tabKey: string,
    at: string,
    captureSessionId: string,
  ): OpenVisitState | null {
    const existing = state.open[tabKey];
    const tab = state.tabs[tabKey];
    if (existing !== undefined) return existing;
    if (tab === undefined) return null;

    const continuationKey = `${tabKey}|${tab.pageId}`;
    const parked = state.parked[continuationKey];
    if (
      parked !== undefined &&
      fromTimestamp(at) - fromTimestamp(parked.endedAt) <= this.policy.visitContinuationMs
    ) {
      delete state.parked[continuationKey];
      const resumed = parked.visit;
      resumed.spanStartedAt = null;
      resumed.signals = {
        ...resumed.signals,
        activationCount: resumed.signals.activationCount + 1,
      };
      state.open[tabKey] = resumed;
      return resumed;
    }

    const created: OpenVisitState = {
      // Derived, never minted: recovery re-folds the same events after a
      // crash and must land on the same Visit rather than a duplicate.
      visitId: deterministicUuid('visit', `${captureSessionId}|${tabKey}|${tab.pageId}|${at}`),
      pageId: tab.pageId,
      tabKey,
      startedAt: at,
      spans: [],
      spanStartedAt: null,
      signals: emptySignals(tab.cause, tab.referrerPageId, 1),
      captureSessionId,
    };
    state.open[tabKey] = created;
    return created;
  }

  private finish(
    state: VisitBuilderState,
    tabKey: string,
    at: string,
    closedBy: AttentionSpan['closedBy'],
    out: Visit[],
  ): void {
    const open = state.open[tabKey];
    if (open === undefined) return;
    this.closeSpan(open, at, closedBy, state.lastActivityAt);
    const visit = this.snapshot(open, at, 'closed');
    out.push(visit);
    state.parked[`${tabKey}|${open.pageId}`] = { endedAt: visit.endedAt ?? at, visit: open };
    delete state.open[tabKey];
  }

  /** Continuation candidates are only useful inside the window; drop the rest. */
  private pruneParked(state: VisitBuilderState, at: string): void {
    const cutoff = fromTimestamp(at) - this.policy.visitContinuationMs;
    for (const [key, entry] of Object.entries(state.parked)) {
      if (fromTimestamp(entry.endedAt) < cutoff) delete state.parked[key];
    }
  }

  apply(previous: VisitBuilderState, event: BrowserEvent): ApplyResult {
    const state: VisitBuilderState = structuredClone(previous);
    const out: Visit[] = [];
    const at = event.occurredAt;
    this.pruneParked(state, at);

    switch (event.type) {
      case 'tracking_changed': {
        state.trackingEnabled = event.enabled;
        if (!event.enabled) {
          for (const tabKey of Object.keys(state.open)) {
            this.finish(state, tabKey, at, 'shutdown', out);
          }
        }
        break;
      }

      case 'navigation_committed': {
        // Navigating away ends the previous Visit in that tab, focused or not.
        const previousTab = state.tabs[event.tabKey];
        if (previousTab !== undefined && previousTab.pageId !== event.pageId) {
          this.finish(state, event.tabKey, at, 'navigation', out);
        }
        state.tabs[event.tabKey] = {
          pageId: event.pageId,
          cause: event.cause,
          referrerPageId: event.referrerPageId,
        };
        // A background tab that finishes loading gets no Visit and no time.
        if (state.focusedTab === event.tabKey && this.canFocus(state)) {
          state.lastActivityAt = at;
          const open = this.ensureVisit(state, event.tabKey, at, event.captureSessionId);
          if (open !== null) {
            this.openSpan(open, at);
            out.push(this.snapshot(open, at, 'open'));
          }
        }
        break;
      }

      case 'tab_activated': {
        if (state.focusedTab !== null && state.focusedTab !== event.tabKey) {
          const leaving = state.open[state.focusedTab];
          if (leaving !== undefined) {
            this.closeSpan(leaving, at, 'tab_switch', state.lastActivityAt);
            out.push(this.snapshot(leaving, at, 'open'));
          }
        }
        state.focusedTab = event.tabKey;
        if (event.pageId !== null && state.tabs[event.tabKey] === undefined) {
          state.tabs[event.tabKey] = { pageId: event.pageId, cause: 'other', referrerPageId: null };
        }
        if (this.canFocus(state)) {
          state.lastActivityAt = at;
          const open = this.ensureVisit(state, event.tabKey, at, event.captureSessionId);
          if (open !== null) {
            if (open.spanStartedAt === null && open.spans.length > 0) {
              open.signals = { ...open.signals, activationCount: open.signals.activationCount + 1 };
            }
            this.openSpan(open, at);
            out.push(this.snapshot(open, at, 'open'));
          }
        }
        break;
      }

      case 'window_focus_changed': {
        if (event.focused) {
          state.browserFocused = true;
          if (event.tabKey !== null) state.focusedTab = event.tabKey;
          if (state.focusedTab !== null && this.canFocus(state)) {
            state.lastActivityAt = at;
            const open = this.ensureVisit(state, state.focusedTab, at, event.captureSessionId);
            if (open !== null) {
              this.openSpan(open, at);
              out.push(this.snapshot(open, at, 'open'));
            }
          }
        } else {
          state.browserFocused = false;
          if (state.focusedTab !== null) {
            const open = state.open[state.focusedTab];
            if (open !== undefined) {
              this.closeSpan(open, at, 'blur', state.lastActivityAt);
              out.push(this.snapshot(open, at, 'open'));
            }
          }
        }
        break;
      }

      case 'idle_state_changed': {
        const wasActive = state.idle === 'active';
        state.idle = event.state;
        if (event.state === 'active' && !wasActive) {
          state.lastActivityAt = at;
          if (state.focusedTab !== null && this.canFocus(state)) {
            const open = this.ensureVisit(state, state.focusedTab, at, event.captureSessionId);
            if (open !== null) {
              this.openSpan(open, at);
              out.push(this.snapshot(open, at, 'open'));
            }
          }
        } else if (event.state !== 'active' && wasActive && state.focusedTab !== null) {
          const open = state.open[state.focusedTab];
          if (open !== undefined) {
            this.closeSpan(open, at, 'idle', state.lastActivityAt);
            out.push(this.snapshot(open, at, 'open'));
          }
        }
        break;
      }

      case 'tab_closed': {
        this.finish(state, event.tabKey, at, 'tab_closed', out);
        delete state.tabs[event.tabKey];
        if (state.focusedTab === event.tabKey) state.focusedTab = null;
        break;
      }

      case 'interaction': {
        const open = state.open[event.tabKey];
        if (open === undefined || open.pageId !== event.pageId) break;
        state.lastActivityAt = at;
        const signals = { ...open.signals };
        if (event.kind === 'scroll') signals.scrolled = true;
        if (event.kind === 'selection') signals.selected = true;
        if (event.kind === 'copy') signals.copied = true;
        if (event.kind === 'media_playback') signals.mediaPlayback = true;
        open.signals = signals;
        out.push(this.snapshot(open, at, 'open'));
        break;
      }
    }

    return { state, visits: out };
  }

  /** Applies a batch in order. Used by both live ingest and replay. */
  applyAll(previous: VisitBuilderState, events: readonly BrowserEvent[]): ApplyResult {
    let state = previous;
    const merged = new Map<string, Visit>();
    for (const event of events) {
      const result = this.apply(state, event);
      state = result.state;
      for (const visit of result.visits) merged.set(visit.visitId, visit);
    }
    return { state, visits: [...merged.values()] };
  }

  /**
   * Forces every open Visit closed — used at shutdown and when the user turns
   * tracking off, so a Visit is never left dangling across a browser restart.
   */
  flush(previous: VisitBuilderState, at: string): ApplyResult {
    const state = structuredClone(previous);
    const out: Visit[] = [];
    for (const tabKey of Object.keys(state.open)) {
      this.finish(state, tabKey, at, 'shutdown', out);
    }
    return { state, visits: out };
  }
}
