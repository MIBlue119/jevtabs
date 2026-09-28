import { defineConfig } from 'wxt';

/**
 * Permissions are deliberately minimal and progressive.
 *
 * `tabs`, `idle`, and `storage` are enough to reconstruct foreground attention:
 * they give navigation, activation, window focus, and presence. No host
 * permission is requested at install time, which means JevTabs cannot read a
 * single page until the person explicitly turns interaction signals on in
 * Settings — at which point the content script is registered at runtime
 * against the optional `<all_urls>` grant.
 */
export default defineConfig({
  srcDir: 'src',

  hooks: {
    /**
     * WXT promotes a runtime-registered content script's `matches` into
     * `host_permissions`, which would make `<all_urls>` a required
     * install-time grant — exactly the thing this design avoids. The grant
     * belongs in `optional_host_permissions`, requested only when someone
     * turns interaction signals on, so it is moved back here and asserted in
     * the extension's manifest test.
     */
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
      manifest.optional_host_permissions = ['<all_urls>'];
    },
  },

  modules: ['@wxt-dev/module-react'],
  // Explicit imports only: an auto-import that silently pulls in a browser API
  // would undermine the adapter boundary the architecture depends on.
  imports: false,
  manifest: {
    name: 'JevTabs',
    description:
      'A local-first browser context workspace. Reconstructs durable, source-backed Threads from chaotic browsing.',
    permissions: ['tabs', 'storage', 'idle', 'alarms', 'sidePanel', 'unlimitedStorage'],
    optional_host_permissions: ['<all_urls>'],
    minimum_chrome_version: '116',
    action: {
      default_title: 'JevTabs',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
