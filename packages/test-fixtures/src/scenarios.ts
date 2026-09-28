import type { BrowserEvent, Page } from '@jevtabs/core-domain';
import { MINUTE_MS, SECOND_MS } from '@jevtabs/core-domain';
import { Tape, createHarness, makePage, type Harness } from './builders.js';

/**
 * The scenario the product is designed around: a morning of interleaved
 * browsing where real work, an ambient mail tab, a stale trip-planning tab,
 * and a personal detour all share the same window.
 *
 * A correct implementation produces Visits for the research pages only, leaves
 * the sixteen-day-old tab alone, and never counts background load time.
 */

export interface InterleavedSession {
  readonly harness: Harness;
  readonly events: BrowserEvent[];
  readonly pages: Readonly<{
    search: Page;
    announcement: Page;
    repo: Page;
    performance: Page;
    mail: Page;
    staleTrip: Page;
    personal: Page;
  }>;
}

export function interleavedMorning(): InterleavedSession {
  const harness = createHarness();

  const pages = {
    search: makePage('https://www.google.com/search', 'JEV browser classification - Google Search'),
    announcement: makePage(
      'https://typesafe.ai/blog/introducing-system-one-models-and-jev',
      'Introducing System One Models & Jev',
    ),
    repo: makePage('https://github.com/browser-use/jev-ultrafast', 'browser-use/jev-ultrafast'),
    performance: makePage(
      'https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md',
      'Faster on the real web — performance.md',
    ),
    mail: makePage('https://mail.google.com/mail/u/0/', 'Inbox (18) - Gmail'),
    staleTrip: makePage(
      'https://www.example-travel.com/beijing/waldorf-astoria',
      '北京華爾道夫酒店 — 冬季住房',
    ),
    personal: makePage('https://news.example.com/tech/daily', 'Tech Daily'),
  } as const;

  const tape = new Tape(harness);

  // A tab left open from a fortnight ago. It exists; it is not being used.
  tape.navigate(0, '1:9', pages.staleTrip, { cause: 'typed' });
  tape.navigate(0, '1:4', pages.mail, { cause: 'typed' });

  // Real work begins.
  tape.navigate(12 * MINUTE_MS, '1:1', pages.search, { cause: 'typed' });
  tape.activate(12 * MINUTE_MS, '1:1', pages.search);
  tape.interact(12 * MINUTE_MS + 20 * SECOND_MS, '1:1', pages.search, 'scroll');

  tape.navigate(15 * MINUTE_MS, '1:1', pages.announcement, { referrer: pages.search });
  tape.interact(16 * MINUTE_MS, '1:1', pages.announcement, 'scroll');
  tape.interact(18 * MINUTE_MS, '1:1', pages.announcement, 'selection');

  // The repo opens in a background tab and sits there before it is read.
  tape.navigate(19 * MINUTE_MS, '1:2', pages.repo, { referrer: pages.announcement });
  tape.activate(22 * MINUTE_MS, '1:2', pages.repo);
  tape.interact(23 * MINUTE_MS, '1:2', pages.repo, 'copy');

  // A glance at mail: short, ambient, not work.
  tape.activate(24 * MINUTE_MS, '1:4', pages.mail);
  tape.activate(24 * MINUTE_MS + 40 * SECOND_MS, '1:2', pages.repo);

  tape.navigate(28 * MINUTE_MS, '1:2', pages.performance, { referrer: pages.repo });
  tape.interact(29 * MINUTE_MS, '1:2', pages.performance, 'scroll');

  // Lunch: the machine is left unattended with the tab in the foreground.
  tape.idle(34 * MINUTE_MS, 'idle');
  tape.idle(94 * MINUTE_MS, 'active');

  // A personal detour that should not be folded into the research Thread.
  tape.navigate(95 * MINUTE_MS, '1:3', pages.personal, { cause: 'typed' });
  tape.activate(95 * MINUTE_MS, '1:3', pages.personal);
  tape.interact(96 * MINUTE_MS, '1:3', pages.personal, 'scroll');

  tape.activate(99 * MINUTE_MS, '1:2', pages.performance);
  tape.focus(104 * MINUTE_MS, false);

  return { harness, events: tape.build(), pages };
}
