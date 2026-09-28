import { defineBackground } from 'wxt/utils/define-background';
import {
  pageIdFor,
  toTimestamp,
  tryNormalizeUrl,
  type BrowserEventDraft,
} from '@jevtabs/core-domain';
import { causeOf, tabKeyOf } from '../background/browser-adapter.js';
import { getSession } from '../background/session.js';
import { db } from '../storage/db.js';
import { applyRetention, openReviewCount, refreshDormancy } from '../storage/repository.js';

/**
 * The capture adapter.
 *
 * Chrome's callbacks arrive out of order and in bursts, and the service worker
 * can be terminated between any two of them. Two mechanisms handle that:
 *
 *   - every observation is queued and drained through one serialized promise
 *     chain, so two bursts can never interleave a fold;
 *   - the drain persists before it resolves, and a cold start calls
 *     `recover()`, which re-folds anything the durable log has that the
 *     projection has not seen.
 *
 * Note what is *not* here: no `chrome.webRequest`, no `chrome.history`, no
 * content script by default. Navigation, activation, window focus, and idle are
 * enough to reconstruct foreground attention, and they need no host permission.
 */

const IDLE_DETECTION_SECONDS = 60;
const DRAIN_DEBOUNCE_MS = 400;

export default defineBackground(() => {
  let queue: BrowserEventDraft[] = [];
  let draining: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function enqueue(draft: BrowserEventDraft | null): void {
    if (draft === null) return;
    queue.push(draft);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, DRAIN_DEBOUNCE_MS);
  }

  function drain(): Promise<unknown> {
    const batch = queue;
    queue = [];
    if (batch.length === 0) return draining;
    draining = draining
      .then(async () => {
        const session = await getSession();
        await session.pipeline.handle(batch);
        await refreshBadge();
      })
      .catch((error: unknown) => {
        // A failed batch must not poison the chain; the events are already
        // durable or were never accepted, so the next drain is still correct.
        console.error('[jevtabs] capture batch failed', error);
      });
    return draining;
  }

  async function refreshBadge(): Promise<void> {
    const open = await openReviewCount(db());
    await chrome.action.setBadgeText({ text: open === 0 ? '' : String(Math.min(open, 99)) });
    await chrome.action.setBadgeBackgroundColor({ color: '#c57b20' });
  }

  function navigationDraft(
    tab: chrome.tabs.Tab,
    transition: string | undefined,
    occurredAt: string,
  ): BrowserEventDraft | null {
    const tabKey = tabKeyOf(tab);
    if (tabKey === null) return null;
    // `tab.incognito` is the last line of defence; the policy refuses it too.
    if (tab.incognito) return null;
    if (tab.url === undefined) return null;
    const normalized = tryNormalizeUrl(tab.url);
    if (normalized === null) return null;

    return {
      type: 'navigation_committed',
      occurredAt,
      tabKey,
      pageId: pageIdFor(normalized),
      url: normalized.href,
      title: tab.title ?? '',
      cause: causeOf(transition),
      referrerPageId: null,
    };
  }

  async function currentTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      // The tab closed between the event and this call. Normal, not an error.
      return null;
    }
  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // `complete` is the point at which the title is trustworthy.
    if (changeInfo.status !== 'complete' && changeInfo.title === undefined) return;
    enqueue(navigationDraft(tab, undefined, toTimestamp(Date.now())));
    void tabId;
  });

  chrome.tabs.onActivated.addListener((info) => {
    const occurredAt = toTimestamp(Date.now());
    void (async () => {
      const tab = await currentTab(info.tabId);
      const tabKey = tab === null ? null : tabKeyOf(tab);
      if (tabKey === null) return;
      if (tab?.incognito === true) return;

      // Emit the navigation first so the tab's page identity is known before
      // the activation that starts counting attention against it.
      enqueue(navigationDraft(tab as chrome.tabs.Tab, undefined, occurredAt));
      const normalized = tab?.url === undefined ? null : tryNormalizeUrl(tab.url);
      enqueue({
        type: 'tab_activated',
        occurredAt,
        tabKey,
        pageId: normalized === null ? null : pageIdFor(normalized),
      });
      void drain();
    })();
  });

  chrome.tabs.onRemoved.addListener((tabId, info) => {
    enqueue({
      type: 'tab_closed',
      occurredAt: toTimestamp(Date.now()),
      tabKey: `${info.windowId}:${tabId}`,
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    const occurredAt = toTimestamp(Date.now());
    void (async () => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        enqueue({ type: 'window_focus_changed', occurredAt, tabKey: null, focused: false });
        await drain();
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      const tabKey = tab === undefined ? null : tabKeyOf(tab);
      if (tab?.incognito === true) return;
      enqueue({ type: 'window_focus_changed', occurredAt, tabKey, focused: true });
      await drain();
    })();
  });

  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.idle.onStateChanged.addListener((state) => {
    enqueue({ type: 'idle_state_changed', occurredAt: toTimestamp(Date.now()), state });
    void drain();
  });

  /** Coarse interaction signals from the optional content script. */
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (typeof message !== 'object' || message === null) return;
    const payload = message as { kind?: string; signal?: string };
    if (payload.kind !== 'jevtabs:interaction') return;
    if (sender.tab === undefined || sender.tab.incognito) return;

    const tabKey = tabKeyOf(sender.tab);
    const normalized = sender.tab.url === undefined ? null : tryNormalizeUrl(sender.tab.url);
    if (tabKey === null || normalized === null) return;
    if (
      payload.signal !== 'scroll' &&
      payload.signal !== 'selection' &&
      payload.signal !== 'copy' &&
      payload.signal !== 'media_playback'
    ) {
      return;
    }

    enqueue({
      type: 'interaction',
      occurredAt: toTimestamp(Date.now()),
      tabKey,
      pageId: pageIdFor(normalized),
      kind: payload.signal,
    });
  });

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
      // Older Chrome builds without the side panel behaviour API: not fatal.
    });
    chrome.alarms.create('jevtabs:maintenance', { periodInMinutes: 60 });
    void getSession(true);
  });

  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      // A browser restart ends every open Visit at the last moment we had
      // evidence of attention, then starts a fresh capture session.
      const previous = await getSession();
      await previous.pipeline.flush();
      const next = await getSession(true);
      await next.pipeline.recover();
      await refreshBadge();
    })();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'jevtabs:maintenance') return;
    void (async () => {
      const session = await getSession();
      const context = { database: db(), clock: session.clock, ids: session.ids };
      await applyRetention(context);
      await refreshDormancy(context);
      await refreshBadge();
    })();
  });

  // Cold start: the worker may have been killed mid-fold.
  void (async () => {
    const session = await getSession();
    await session.pipeline.recover();
    await refreshBadge();
  })();
});
