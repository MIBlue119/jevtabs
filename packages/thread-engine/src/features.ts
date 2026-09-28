import {
  type Page,
  type Visit,
  type VisitFeatures,
  dedupe,
  termsOf,
} from '@jevtabs/core-domain';

/**
 * Hosts whose pages are almost always ambient rather than intentional work:
 * a mail client left open for a week is not research. They are not blocked —
 * they just start with a penalty, and a long deliberate visit still wins.
 */
export const AMBIENT_HOSTS: readonly string[] = [
  'mail.google.com',
  'gmail.com',
  'teams.microsoft.com',
  'outlook.office.com',
  'outlook.live.com',
  'calendar.google.com',
  'slack.com',
  'app.slack.com',
  'discord.com',
  'web.whatsapp.com',
  'messenger.com',
];

/** Search result pages are waypoints: high signal for intent, low as sources. */
export const SEARCH_HOSTS: readonly string[] = [
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'search.brave.com',
  'ecosia.org',
  'perplexity.ai',
  'kagi.com',
];

export function isAmbientHost(host: string): boolean {
  return AMBIENT_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function isSearchHost(host: string): boolean {
  return SEARCH_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Projects a Visit into the minimized view a DecisionProvider is allowed to
 * see. Titles and path terms only — never a page body. Keeping the projection
 * here means a remote adapter physically cannot receive more than this.
 */
export function visitFeatures(
  visit: Visit,
  page: Page,
  referrerThreadIds: readonly string[] = [],
): VisitFeatures {
  const path = new URL(page.url).pathname;
  const terms = dedupe([
    ...termsOf(page.title),
    ...termsOf(path.replace(/[/\-_.]/g, ' ')),
  ]).slice(0, 48);

  return {
    visitId: visit.visitId,
    pageId: visit.pageId,
    host: page.host,
    path,
    title: page.title,
    terms,
    startedAt: visit.startedAt,
    foregroundMs: visit.foregroundMs,
    activationCount: visit.signals.activationCount,
    signals: {
      scrolled: visit.signals.scrolled,
      selected: visit.signals.selected,
      copied: visit.signals.copied,
    },
    cause: visit.signals.cause,
    referrerThreadIds: [...referrerThreadIds],
  };
}
