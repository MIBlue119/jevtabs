import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONTRACT_FILES = [
  'events.schema.json',
  'domain.schema.json',
  'context-pack.schema.json',
  'settings.schema.json',
] as const;

/**
 * The committed JSON Schemas are the published form of the Zod definitions.
 * They exist so a companion process or importer written in another language
 * can validate the same bytes, which only works if they never drift.
 */
describe('published JSON schemas', () => {
  it.each(CONTRACT_FILES)('%s is valid JSON with the expected envelope', (name) => {
    const document = JSON.parse(readFileSync(join(process.cwd(), 'contracts', name), 'utf8'));
    expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document.$id).toContain(name);
    expect(Object.keys(document.$defs).length).toBeGreaterThan(0);
  });

  it('describes the full BrowserEvent union, one branch per event type', () => {
    const document = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'events.schema.json'), 'utf8'),
    );
    const branches = document.$defs.BrowserEvent.oneOf ?? document.$defs.BrowserEvent.anyOf;
    const types = branches.map((branch: { properties: { type: { const: string } } }) =>
      branch.properties.type.const,
    );
    expect(types).toEqual([
      'navigation_committed',
      'tab_activated',
      'tab_closed',
      'window_focus_changed',
      'idle_state_changed',
      'interaction',
      'tracking_changed',
    ]);
  });

  it('exposes no field that could hold page bodies, form values, or headers', () => {
    const forbidden = [
      'body',
      'html',
      'text',
      'content',
      'value',
      'cookie',
      'cookies',
      'header',
      'headers',
      'authorization',
      'password',
      'token',
      'clipboard',
      'screenshot',
      'keystroke',
    ];
    const document = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'events.schema.json'), 'utf8'),
    );
    const branches = document.$defs.BrowserEvent.oneOf ?? document.$defs.BrowserEvent.anyOf;
    for (const branch of branches) {
      for (const field of Object.keys(branch.properties)) {
        expect(forbidden, `BrowserEvent.${field}`).not.toContain(field.toLowerCase());
      }
    }
  });
});
