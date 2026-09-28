import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_QUERY_ALLOWLIST,
  hostMatches,
  normalizeUrl,
  pageIdFor,
  tryNormalizeUrl,
  UrlRejected,
} from '@jevtabs/core-domain';

describe('normalizeUrl', () => {
  it('drops the fragment unconditionally', () => {
    expect(normalizeUrl('https://example.com/docs#access_token=abc').href).toBe(
      'https://example.com/docs',
    );
  });

  it('drops every query value when no allowlist is configured', () => {
    expect(normalizeUrl('https://example.com/a?session=secret&utm_source=x').href).toBe(
      'https://example.com/a',
    );
  });

  it('keeps only allowlisted parameters, in a stable order', () => {
    const first = normalizeUrl('https://example.com/w?v=abc&id=9&session=secret', {
      queryAllowlist: DOCUMENT_QUERY_ALLOWLIST,
    });
    const second = normalizeUrl('https://example.com/w?id=9&session=secret&v=abc', {
      queryAllowlist: DOCUMENT_QUERY_ALLOWLIST,
    });
    expect(first.href).toBe('https://example.com/w?id=9&v=abc');
    expect(second.href).toBe(first.href);
  });

  it('rejects URLs that carry credentials rather than stripping them', () => {
    expect(() => normalizeUrl('https://user:pw@example.com/x')).toThrow(UrlRejected);
  });

  it.each([
    'chrome://settings',
    'chrome-extension://abc/page.html',
    'about:blank',
    'file:///Users/someone/secret.txt',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
  ])('refuses the opaque scheme %s', (raw) => {
    expect(tryNormalizeUrl(raw)).toBeNull();
  });

  it('canonicalizes host case, www, default ports, and trailing slashes', () => {
    const variants = [
      'https://WWW.Example.COM:443/docs/',
      'https://example.com/docs',
      'https://www.example.com//docs//',
    ];
    const hrefs = new Set(variants.map((raw) => normalizeUrl(raw).href));
    expect([...hrefs]).toEqual(['https://example.com/docs']);
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('http://localhost:5173/app').href).toBe('http://localhost:5173/app');
  });

  it('derives a root domain for exclusion matching', () => {
    expect(normalizeUrl('https://docs.api.example.co.uk/x').rootDomain).toBe('example.co.uk');
    expect(normalizeUrl('https://a.b.example.com/x').rootDomain).toBe('example.com');
  });
});

describe('pageIdFor', () => {
  it('is stable across replays and differs per URL', () => {
    const a = pageIdFor(normalizeUrl('https://example.com/a'));
    expect(a).toBe(pageIdFor(normalizeUrl('https://www.example.com/a/')));
    expect(a).not.toBe(pageIdFor(normalizeUrl('https://example.com/b')));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('hostMatches', () => {
  it('covers subdomains but not sibling suffixes', () => {
    expect(hostMatches('mail.example.com', 'example.com')).toBe(true);
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('notexample.com', 'example.com')).toBe(false);
  });
});
