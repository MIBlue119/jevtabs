import type { BrowserEventDraft, NavigationCause } from '@jevtabs/core-domain';

/**
 * The only file in the extension that touches `chrome.*` for capture.
 *
 * Everything below it works on `BrowserEventDraft`, which is why the whole
 * capture pipeline can be tested without a browser. The adapter's job is
 * narrow: translate browser callbacks into drafts, and expose the handful of
 * browser capabilities the rest of the code needs.
 */

export interface BrowserAdapter {
  tabKey(tab: { windowId?: number; id?: number }): string | null;
  onEvent(handler: (draft: BrowserEventDraft) => void): void;
  /** Resolves the tab that currently has focus, if any. */
  activeTab(): Promise<chrome.tabs.Tab | null>;
  openWorkspace(): Promise<void>;
  setBadge(text: string, title: string): Promise<void>;
}

/** Chrome reports `-1` for "no window"; both ids are needed to be unique. */
export function tabKeyOf(tab: { windowId?: number; id?: number }): string | null {
  if (tab.windowId === undefined || tab.id === undefined) return null;
  if (tab.windowId < 0 || tab.id < 0) return null;
  return `${tab.windowId}:${tab.id}`;
}

const TRANSITION_MAP: Record<string, NavigationCause> = {
  link: 'link',
  typed: 'typed',
  auto_bookmark: 'other',
  auto_subframe: 'auto_subframe',
  manual_subframe: 'auto_subframe',
  generated: 'generated',
  start_page: 'other',
  form_submit: 'form_submit',
  reload: 'reload',
  keyword: 'typed',
  keyword_generated: 'generated',
};

export function causeOf(transition: string | undefined): NavigationCause {
  if (transition === undefined) return 'other';
  return TRANSITION_MAP[transition] ?? 'other';
}

export interface AdapterDependencies {
  readonly now: () => number;
  /** Turns a raw tab into a draft, or null when policy refuses it. */
  readonly toNavigationDraft: (input: {
    tabKey: string;
    url: string;
    title: string;
    cause: NavigationCause;
    occurredAt: string;
  }) => Promise<BrowserEventDraft | null>;
  readonly toPageId: (url: string) => string | null;
}
