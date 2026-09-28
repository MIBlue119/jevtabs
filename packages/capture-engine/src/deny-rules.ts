/**
 * Built-in deny rules.
 *
 * These are a floor, not a guarantee. No list can enumerate every sensitive
 * surface on the web, so JevTabs pairs this with per-domain exclusions, a
 * global pause, and a capture contract that never records page bodies, form
 * values, headers, or cookies in the first place. The rules below simply make
 * the obviously wrong cases impossible by default.
 *
 * A rule is only added here when a false positive is cheap (one page is not
 * recorded) and a false negative is expensive (a credential-bearing URL is).
 */

export interface DenyRule {
  readonly id: string;
  readonly category:
    | 'authentication'
    | 'password_manager'
    | 'payment'
    | 'banking'
    | 'health'
    | 'identity'
    | 'browser_internal';
  readonly hosts?: readonly string[];
  readonly hostPattern?: RegExp;
  readonly pathPattern?: RegExp;
}

export const BUILTIN_DENY_RULES: readonly DenyRule[] = [
  {
    id: 'auth-hosts',
    category: 'authentication',
    hosts: [
      'accounts.google.com',
      'login.microsoftonline.com',
      'login.live.com',
      'appleid.apple.com',
      'idmsa.apple.com',
      'signin.aws.amazon.com',
      'auth0.com',
      'okta.com',
      'id.atlassian.com',
      'github.com/login',
    ],
  },
  {
    id: 'auth-paths',
    category: 'authentication',
    pathPattern:
      /(^|\/)(login|log-in|signin|sign-in|signup|sign-up|register|logout|auth|oauth2?|sso|saml|session|password|passwd|reset-password|forgot|verify|verification|otp|2fa|mfa|totp|recovery|magic-link|callback|token)(\/|$)/i,
  },
  {
    id: 'password-managers',
    category: 'password_manager',
    hostPattern:
      /(^|\.)(1password\.(com|ca|eu)|lastpass\.com|bitwarden\.com|vault\.bitwarden\.com|dashlane\.com|keepersecurity\.com|nordpass\.com|enpass\.io|proton\.me)$/i,
  },
  {
    id: 'payment-hosts',
    category: 'payment',
    hostPattern:
      /(^|\.)(paypal\.(com|me)|checkout\.stripe\.com|pay\.stripe\.com|braintreegateway\.com|squareup\.com|adyen\.com|klarna\.com|lemonsqueezy\.com|paddle\.com|ecpay\.com\.tw|newebpay\.com)$/i,
  },
  {
    id: 'payment-paths',
    category: 'payment',
    pathPattern:
      /(^|\/)(checkout|payment|payments|billing|invoice|invoices|subscribe|subscription|card|cards|wallet|purchase|order-confirmation)(\/|$)/i,
  },
  {
    id: 'banking-hosts',
    category: 'banking',
    hostPattern:
      /(^|\.)((online|ebank|ibank|netbank|secure)\.[a-z0-9-]+\.[a-z.]{2,}|[a-z0-9-]*bank[a-z0-9-]*\.[a-z.]{2,}|[a-z0-9-]*(creditunion|brokerage)\.[a-z.]{2,})$/i,
  },
  {
    id: 'health-hosts',
    category: 'health',
    hostPattern:
      /(^|\.)(mychart\.[a-z0-9-]+\.[a-z.]{2,}|[a-z0-9-]*(patient|myhealth|healthrecord|medicalrecord)[a-z0-9-]*\.[a-z.]{2,})$/i,
  },
  {
    id: 'health-paths',
    category: 'health',
    pathPattern: /(^|\/)(medical-record|health-record|patient|prescription|lab-results)(\/|$)/i,
  },
  {
    id: 'identity-paths',
    category: 'identity',
    pathPattern:
      /(^|\/)(ssn|social-security|passport|national-id|tax-return|kyc|identity-verification)(\/|$)/i,
  },
];

export interface DenyMatch {
  readonly ruleId: string;
  readonly category: DenyRule['category'];
}

export function matchDenyRules(
  host: string,
  path: string,
  rules: readonly DenyRule[] = BUILTIN_DENY_RULES,
): DenyMatch | null {
  for (const rule of rules) {
    if (rule.hosts?.some((entry) => host === entry || `${host}${path}`.startsWith(entry))) {
      return { ruleId: rule.id, category: rule.category };
    }
    if (rule.hostPattern?.test(host)) return { ruleId: rule.id, category: rule.category };
    if (rule.pathPattern?.test(path)) return { ruleId: rule.id, category: rule.category };
  }
  return null;
}
