import {
  DOCUMENT_QUERY_ALLOWLIST,
  type CaptureCandidate,
  type CaptureDecision,
  type ContentPolicy,
  type NormalizedUrl,
  hostMatches,
  tryNormalizeUrl,
} from '@jevtabs/core-domain';
import { BUILTIN_DENY_RULES, matchDenyRules, type DenyRule } from './deny-rules.js';

export interface ContentPolicyOptions {
  /** Hosts the user excluded. Subdomains are covered. */
  readonly excludedDomains?: readonly string[];
  /** Opt-in: keep document-identifying query parameters. Off by default. */
  readonly keepDocumentQueryParams?: boolean;
  /** Overridable so tests can assert on a small rule set. */
  readonly denyRules?: readonly DenyRule[];
}

export interface PolicyResult extends Record<string, unknown> {
  readonly decision: CaptureDecision;
  /** Present only when the candidate was accepted. */
  readonly normalized: NormalizedUrl | null;
  /** Title after redaction. Empty when the title itself was unsafe to keep. */
  readonly title: string;
}

/**
 * Titles occasionally carry what URLs are forbidden to: one-time codes in
 * webmail subject lines, "Reset your password — 483920", and so on. Anything
 * that looks like a standalone secret is removed rather than stored.
 */
const TITLE_SECRET_PATTERNS: readonly RegExp[] = [
  /\b\d{4,8}\b(?=[^\d]*(code|otp|pin|verification|驗證|認證))/i,
  /(code|otp|pin|verification|驗證碼|認證碼)\D{0,12}\b\d{4,8}\b/i,
  /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/, // jwt
  /\b(sk|pk|ghp|gho|ghu|ghs|xox[abposr])[-_][A-Za-z0-9]{16,}\b/, // api keys
  /\bAKIA[0-9A-Z]{16}\b/, // aws access key id
];

export function redactTitle(title: string): string {
  let out = title;
  for (const pattern of TITLE_SECRET_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags.includes('i') ? 'gi' : 'g'), '[redacted]');
  }
  return out.slice(0, 512);
}

/**
 * The single gate every observation passes through before it can be stored.
 * It is deterministic and side-effect free so the privacy suite can enumerate
 * it exhaustively.
 */
export function createContentPolicy(options: ContentPolicyOptions = {}): ContentPolicy & {
  evaluate(input: CaptureCandidate): PolicyResult;
} {
  const excluded = (options.excludedDomains ?? []).map((domain) => domain.toLowerCase().trim());
  const denyRules = options.denyRules ?? BUILTIN_DENY_RULES;
  const queryAllowlist = options.keepDocumentQueryParams ? DOCUMENT_QUERY_ALLOWLIST : [];

  function evaluate(input: CaptureCandidate): PolicyResult {
    const reject = (reason: string): PolicyResult => ({
      decision: { outcome: 'reject', reason },
      normalized: null,
      title: '',
    });

    // Incognito is out of scope entirely — there is no setting that enables it.
    if (input.incognito) return reject('incognito');

    const normalized = tryNormalizeUrl(input.url, { queryAllowlist });
    if (normalized === null) return reject('unsupported_url');

    if (excluded.some((domain) => hostMatches(normalized.host, domain))) {
      return reject('excluded_domain');
    }

    const denied = matchDenyRules(normalized.host, normalized.path, denyRules);
    if (denied !== null) return reject(`denied_${denied.category}`);

    const title = redactTitle(input.title);
    const redacted = title !== input.title.slice(0, 512);

    return {
      decision: redacted ? { outcome: 'redact', reason: 'title_secret' } : { outcome: 'accept' },
      normalized,
      title,
    };
  }

  return {
    inspect: (input) => evaluate(input).decision,
    evaluate,
  };
}
