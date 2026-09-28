import {
  type BrowserEvent,
  type BrowserEventDraft,
  type Page,
  type NavigationCause,
  type Thread,
  type Clock,
  type IdGenerator,
  createIdGenerator,
  fixedClock,
  normalizeUrl,
  pageIdFor,
  seededRandom,
  termsOf,
  toTimestamp,
} from '@jevtabs/core-domain';

/**
 * Deterministic builders for tests. Real browsing data never enters this
 * repository — every fixture is synthesized here from a seeded generator, so a
 * failing test can be reproduced exactly and shared in an issue.
 */

export const FIXTURE_EPOCH = Date.parse('2026-09-18T09:00:00.000Z');

export interface Harness {
  readonly clock: Clock & { advance(ms: number): void; set(ms: number): void };
  readonly ids: IdGenerator;
  readonly captureSessionId: string;
}

export function createHarness(startMs: number = FIXTURE_EPOCH, seed = 42): Harness {
  const clock = fixedClock(startMs);
  const ids = createIdGenerator(clock, seededRandom(seed));
  return { clock, ids, captureSessionId: ids.next() };
}

export function makePage(url: string, title: string, seenAt = FIXTURE_EPOCH): Page {
  const normalized = normalizeUrl(url);
  return {
    schemaVersion: 1,
    pageId: pageIdFor(normalized),
    url: normalized.href,
    host: normalized.host,
    rootDomain: normalized.rootDomain,
    title,
    firstSeenAt: toTimestamp(seenAt),
    lastSeenAt: toTimestamp(seenAt),
    trust: 'untrusted_source_content',
  };
}

export function makeThread(
  harness: Harness,
  overrides: Partial<Thread> & { title: string },
): Thread {
  const now = toTimestamp(harness.clock.now());
  return {
    schemaVersion: 1,
    threadId: harness.ids.next(),
    intent: '',
    status: 'active',
    accent: 'green',
    keywords: termsOf(overrides.title, 16),
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    origin: 'auto',
    confirmed: false,
    ...overrides,
  };
}

/** Stamps a draft the way the ingest boundary would, without touching storage. */
export function stamp(harness: Harness, draft: BrowserEventDraft): BrowserEvent {
  return {
    ...draft,
    schemaVersion: 1,
    eventId: harness.ids.next(),
    recordedAt: draft.occurredAt,
    captureSessionId: harness.captureSessionId,
  } as BrowserEvent;
}

/** Fluent builder for an event tape. Every `at` is relative to the harness epoch. */
export class Tape {
  private readonly events: BrowserEvent[] = [];

  constructor(private readonly harness: Harness) {}

  private at(offsetMs: number): string {
    return toTimestamp(FIXTURE_EPOCH + offsetMs);
  }

  navigate(
    offsetMs: number,
    tabKey: string,
    page: Page,
    options: { cause?: NavigationCause; referrer?: Page } = {},
  ): this {
    this.events.push(
      stamp(this.harness, {
        type: 'navigation_committed',
        occurredAt: this.at(offsetMs),
        tabKey,
        pageId: page.pageId,
        url: page.url,
        title: page.title,
        cause: options.cause ?? 'link',
        referrerPageId: options.referrer?.pageId ?? null,
      }),
    );
    return this;
  }

  activate(offsetMs: number, tabKey: string, page: Page | null = null): this {
    this.events.push(
      stamp(this.harness, {
        type: 'tab_activated',
        occurredAt: this.at(offsetMs),
        tabKey,
        pageId: page?.pageId ?? null,
      }),
    );
    return this;
  }

  interact(
    offsetMs: number,
    tabKey: string,
    page: Page,
    kind: 'scroll' | 'selection' | 'copy' | 'media_playback',
  ): this {
    this.events.push(
      stamp(this.harness, {
        type: 'interaction',
        occurredAt: this.at(offsetMs),
        tabKey,
        pageId: page.pageId,
        kind,
      }),
    );
    return this;
  }

  focus(offsetMs: number, focused: boolean, tabKey: string | null = null): this {
    this.events.push(
      stamp(this.harness, {
        type: 'window_focus_changed',
        occurredAt: this.at(offsetMs),
        tabKey,
        focused,
      }),
    );
    return this;
  }

  idle(offsetMs: number, state: 'active' | 'idle' | 'locked'): this {
    this.events.push(
      stamp(this.harness, { type: 'idle_state_changed', occurredAt: this.at(offsetMs), state }),
    );
    return this;
  }

  close(offsetMs: number, tabKey: string): this {
    this.events.push(
      stamp(this.harness, { type: 'tab_closed', occurredAt: this.at(offsetMs), tabKey }),
    );
    return this;
  }

  build(): BrowserEvent[] {
    return [...this.events];
  }
}
