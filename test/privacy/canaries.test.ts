import { describe, expect, it } from 'vitest';
import { createContentPolicy } from '@jevtabs/capture-engine';
import { OPAQUE_SCHEMES, normalizeUrl, tryNormalizeUrl } from '@jevtabs/core-domain';
import {
  ADVERSARIAL_PAGES,
  CANARY_TITLES,
  CANARY_URLS,
  allCanarySecrets,
  interleavedMorning,
} from '@jevtabs/test-fixtures';

/**
 * Privacy canaries.
 *
 * These tests assert on the absence of specific bytes. A policy that is
 * correct in prose but leaks one field is indistinguishable, from the user's
 * point of view, from no policy at all — so the suite checks the output, not
 * the intent.
 */

const policy = createContentPolicy();

describe('capture never retains a canary secret', () => {
  it.each([...CANARY_URLS, ...CANARY_TITLES])('$id', (canary) => {
    const result = policy.evaluate({ url: canary.url, title: canary.title, incognito: false });
    const serialized = JSON.stringify({
      normalized: result.normalized,
      title: result.title,
      decision: result.decision,
    });
    expect(serialized, canary.why).not.toContain(canary.secret);
  });
});

describe('the whole fixture session', () => {
  it('produces no stored value containing any canary secret', () => {
    const { events } = interleavedMorning();
    const serialized = JSON.stringify(events);
    for (const secret of allCanarySecrets()) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('records no URL outside http and https', () => {
    const { events } = interleavedMorning();
    for (const event of events) {
      if (!('url' in event)) continue;
      expect(event.url.startsWith('https://') || event.url.startsWith('http://')).toBe(true);
    }
  });

  it('records no query string or fragment', () => {
    const { events } = interleavedMorning();
    for (const event of events) {
      if (!('url' in event)) continue;
      expect(event.url).not.toContain('#');
      expect(event.url).not.toContain('?');
    }
  });
});

describe('opaque and non-web schemes', () => {
  it.each(OPAQUE_SCHEMES)('refuses %s', (scheme) => {
    expect(tryNormalizeUrl(`${scheme}//whatever/path`)).toBeNull();
  });

  it('refuses every browser-internal surface the policy is asked about', () => {
    for (const raw of ['chrome://history', 'edge://settings/passwords', 'about:config']) {
      expect(policy.inspect({ url: raw, title: 'x', incognito: false }).outcome).toBe('reject');
    }
  });
});

describe('page content is never treated as instruction', () => {
  it('stores no field a page body could occupy', () => {
    for (const page of ADVERSARIAL_PAGES) {
      const result = policy.evaluate({ url: page.url, title: page.title, incognito: false });
      const serialized = JSON.stringify(result);
      // The injected instruction text lives only in the fixture; nothing in the
      // capture path has anywhere to put it.
      expect(serialized).not.toContain(page.body);
      expect(Object.keys(result)).toEqual(['decision', 'normalized', 'title']);
    }
  });

  it('keeps an adversarial title as data, with its host intact for attribution', () => {
    const page = ADVERSARIAL_PAGES[0];
    expect(page).toBeDefined();
    const result = policy.evaluate({
      url: page?.url ?? '',
      title: page?.title ?? '',
      incognito: false,
    });
    expect(result.decision.outcome).toBe('accept');
    expect(result.normalized?.host).toBe(normalizeUrl(page?.url ?? '').host);
  });
});
