import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest is a privacy artefact.
 *
 * What an extension may do is decided at install time by the permission list,
 * long before any code runs — so the guarantees in the README are only as good
 * as this file. These assertions run against the real build output and fail if
 * a future change quietly widens the install-time grant.
 */

const MANIFEST = join(import.meta.dirname, '..', '.output', 'chrome-mv3', 'manifest.json');

describe.runIf(existsSync(MANIFEST))('built manifest', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  it('requests no host permission at install time', () => {
    // Host access is what would let JevTabs read page content. It is optional,
    // granted only when someone enables interaction signals, and revocable.
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  });

  it('requests only the permissions the capture design needs', () => {
    expect([...manifest.permissions].sort()).toEqual(
      ['alarms', 'idle', 'sidePanel', 'storage', 'tabs', 'unlimitedStorage'].sort(),
    );
  });

  it('requests none of the permissions that would broaden capture', () => {
    const forbidden = [
      'history',
      'webRequest',
      'webRequestBlocking',
      'cookies',
      'clipboardRead',
      'downloads',
      'debugger',
      'management',
      'proxy',
      'browsingData',
      'contentSettings',
      'declarativeNetRequest',
      'pageCapture',
      'desktopCapture',
      'nativeMessaging',
    ];
    for (const permission of forbidden) {
      expect(manifest.permissions, permission).not.toContain(permission);
    }
  });

  it('declares no static content script', () => {
    expect(manifest.content_scripts ?? []).toEqual([]);
  });

  it('is Manifest V3 with a service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBeDefined();
  });
});
