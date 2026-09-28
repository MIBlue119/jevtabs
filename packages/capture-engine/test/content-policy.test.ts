import { describe, expect, it } from 'vitest';
import { createContentPolicy, redactTitle } from '@jevtabs/capture-engine';
import { CANARY_TITLES, CANARY_URLS } from '@jevtabs/test-fixtures';

const policy = createContentPolicy();

describe('content policy', () => {
  it('handles every canary URL as its contract requires', () => {
    for (const canary of CANARY_URLS) {
      const result = policy.evaluate({ url: canary.url, title: canary.title, incognito: false });
      const label = `${canary.id}: ${canary.why}`;
      if (canary.expect === 'reject') {
        expect(result.decision.outcome, label).toBe('reject');
        expect(result.normalized, label).toBeNull();
      } else {
        expect(result.normalized?.href ?? '', label).not.toContain(canary.secret);
        expect(result.title, label).not.toContain(canary.secret);
      }
    }
  });

  it('never records incognito activity, whatever the URL', () => {
    expect(
      policy.inspect({ url: 'https://example.com/docs', title: 'Docs', incognito: true }),
    ).toEqual({ outcome: 'reject', reason: 'incognito' });
  });

  it('redacts secrets out of otherwise innocuous titles', () => {
    for (const canary of CANARY_TITLES) {
      const result = policy.evaluate({ url: canary.url, title: canary.title, incognito: false });
      expect(result.title, canary.id).not.toContain(canary.secret);
      expect(result.normalized?.href ?? '', canary.id).not.toContain(canary.secret);
    }
  });

  it('accepts ordinary research pages unchanged', () => {
    const result = policy.evaluate({
      url: 'https://github.com/browser-use/jev-ultrafast',
      title: 'browser-use/jev-ultrafast',
      incognito: false,
    });
    expect(result.decision).toEqual({ outcome: 'accept' });
    expect(result.normalized?.host).toBe('github.com');
    expect(result.title).toBe('browser-use/jev-ultrafast');
  });

  it('applies user exclusions to subdomains', () => {
    const scoped = createContentPolicy({ excludedDomains: ['example.com'] });
    expect(
      scoped.inspect({ url: 'https://docs.example.com/x', title: 'x', incognito: false }),
    ).toEqual({ outcome: 'reject', reason: 'excluded_domain' });
    expect(
      scoped.inspect({ url: 'https://notexample.com/x', title: 'x', incognito: false }).outcome,
    ).toBe('accept');
  });

  it('is deterministic and side-effect free', () => {
    const candidate = { url: 'https://example.com/a?b=c', title: 'A', incognito: false };
    expect(policy.evaluate(candidate)).toEqual(policy.evaluate(candidate));
  });
});

describe('redactTitle', () => {
  it('leaves normal titles alone', () => {
    expect(redactTitle('Faster on the real web — performance.md')).toBe(
      'Faster on the real web — performance.md',
    );
  });

  it('removes every occurrence, not just the first', () => {
    const redacted = redactTitle('code 111111 and code 222222');
    expect(redacted).not.toContain('111111');
    expect(redacted).not.toContain('222222');
  });
});
