import { stableId } from './ids.js';

/**
 * URL normalization is a privacy boundary, not a cosmetic step.
 *
 * Query values and fragments routinely carry session tokens, one-time links,
 * reset codes, and personal identifiers, so JevTabs drops them by default and
 * only keeps a query parameter when an explicit allowlist names it. The
 * normalized form is what gets stored, indexed, and shown; the raw href never
 * leaves the capture adapter.
 */

export interface UrlNormalizationOptions {
  /**
   * Query parameter names that are safe to keep because they identify the
   * document rather than the visitor (for example `v` on youtube.com).
   * Matching is case-insensitive and applies to every host.
   */
  readonly queryAllowlist?: readonly string[];
  /** Keep at most this many allowlisted parameters, in sorted order. */
  readonly maxQueryParams?: number;
}

/**
 * An opt-in preset, not a default. With no allowlist configured every query
 * parameter is dropped; Settings can switch this preset on for people who want
 * document-identifying parameters preserved.
 */
export const DOCUMENT_QUERY_ALLOWLIST: readonly string[] = ['v', 'id', 'page', 'p', 'issue', 'pull'];

/** Schemes JevTabs will never record, regardless of user settings. */
export const OPAQUE_SCHEMES: readonly string[] = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'devtools:',
  'edge:',
  'extension:',
  'about:',
  'view-source:',
  'data:',
  'blob:',
  'javascript:',
  'file:',
  'filesystem:',
  'moz-extension:',
];

export interface NormalizedUrl {
  /** Canonical form used as the Page identity. */
  readonly href: string;
  readonly scheme: 'http:' | 'https:';
  /** Lowercased host with a leading `www.` removed. */
  readonly host: string;
  /** Registrable-ish suffix used for exclusion rules and grouping. */
  readonly rootDomain: string;
  readonly path: string;
  /** Path split into non-empty segments; useful for lexical similarity. */
  readonly segments: readonly string[];
}

export class UrlRejected extends Error {
  constructor(readonly reason: 'unparseable' | 'opaque-scheme' | 'non-web-scheme' | 'credentials') {
    super(`URL rejected: ${reason}`);
    this.name = 'UrlRejected';
  }
}

function stripDefaultPort(url: URL): string {
  const isDefault =
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443');
  return isDefault ? url.hostname : url.host;
}

function rootDomainOf(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // Good enough for exclusion rules without shipping a public-suffix list:
  // keep three labels for well-known two-part suffixes, two otherwise.
  const twoPartSuffixes = new Set(['co.uk', 'com.tw', 'co.jp', 'com.au', 'com.br', 'co.nz']);
  const lastTwo = parts.slice(-2).join('.');
  return twoPartSuffixes.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function normalizeUrl(raw: string, options: UrlNormalizationOptions = {}): NormalizedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected('unparseable');
  }

  if (OPAQUE_SCHEMES.includes(url.protocol)) throw new UrlRejected('opaque-scheme');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UrlRejected('non-web-scheme');
  // `https://user:token@host/` — the credential is the payload, drop the whole URL.
  if (url.username !== '' || url.password !== '') throw new UrlRejected('credentials');

  const scheme = url.protocol as 'http:' | 'https:';
  const hostWithPort = stripDefaultPort(url).toLowerCase();
  const host = hostWithPort.startsWith('www.') ? hostWithPort.slice(4) : hostWithPort;

  let path = url.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') path = '/';

  const allowlist = new Set(
    (options.queryAllowlist ?? []).map((name) => name.toLowerCase()).filter((name) => name !== ''),
  );
  const kept: [string, string][] = [];
  if (allowlist.size > 0) {
    for (const [key, value] of url.searchParams) {
      if (allowlist.has(key.toLowerCase())) kept.push([key.toLowerCase(), value]);
    }
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  }
  const limited = kept.slice(0, options.maxQueryParams ?? 4);
  const query = limited.length
    ? `?${limited.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : '';

  // The fragment is dropped unconditionally: it never reaches the server, is
  // frequently used for auth callbacks, and adds no retrieval value.
  const href = `${scheme}//${host}${path}${query}`;

  return {
    href,
    scheme,
    host,
    rootDomain: rootDomainOf(host),
    path,
    segments: path.split('/').filter((segment) => segment !== ''),
  };
}

export function tryNormalizeUrl(
  raw: string,
  options?: UrlNormalizationOptions,
): NormalizedUrl | null {
  try {
    return normalizeUrl(raw, options);
  } catch {
    return null;
  }
}

/** Page identity. Deterministic, so replaying the same events never forks a Page. */
export function pageIdFor(normalized: NormalizedUrl | string): string {
  const href = typeof normalized === 'string' ? normalized : normalized.href;
  return stableId('page', href);
}

/** `true` when `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const needle = domain.toLowerCase().replace(/^\*?\./, '');
  return host === needle || host.endsWith(`.${needle}`);
}
