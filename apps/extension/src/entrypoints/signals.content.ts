import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Optional interaction signals.
 *
 * This script is **not** registered at install time. It exists only if the
 * person turns interaction signals on in Settings, which triggers a runtime
 * request for the optional `<all_urls>` grant. Until then JevTabs has no host
 * permission and cannot read a single page.
 *
 * What it sends is deliberately impoverished: four booleans' worth of
 * information — that a scroll happened, that *something* was selected, that
 * *something* was copied, that media played. Never the selection, never the
 * clipboard, never the text, never coordinates. That restraint is the entire
 * justification for the permission, so it is enforced here at the source
 * rather than downstream.
 */

const THROTTLE_MS = 5_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Registered dynamically from Settings, never from the manifest.
  registration: 'runtime',
  runAt: 'document_idle',

  main() {
    const lastSent = new Map<string, number>();

    function send(signal: 'scroll' | 'selection' | 'copy' | 'media_playback'): void {
      const now = Date.now();
      const previous = lastSent.get(signal) ?? 0;
      if (now - previous < THROTTLE_MS) return;
      lastSent.set(signal, now);
      // A fire-and-forget message: the page must never be able to tell whether
      // JevTabs is listening, and a rejected send is not worth surfacing.
      void chrome.runtime.sendMessage({ kind: 'jevtabs:interaction', signal }).catch(() => {});
    }

    window.addEventListener('scroll', () => send('scroll'), { passive: true, capture: true });

    document.addEventListener(
      'selectionchange',
      () => {
        const selection = document.getSelection();
        // Only the fact that a non-empty selection exists crosses this line.
        if (selection !== null && selection.toString().trim().length > 0) send('selection');
      },
      { passive: true },
    );

    document.addEventListener('copy', () => send('copy'), { passive: true, capture: true });

    document.addEventListener('play', () => send('media_playback'), {
      passive: true,
      capture: true,
    });
  },
});
