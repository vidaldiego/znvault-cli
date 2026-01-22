// Path: src/lib/config/plugins.ts

/**
 * Plugin configuration management
 */

import type { CLIPluginConfig } from '../../plugins/types.js';
import { store } from './store.js';

/**
 * Get all configured plugins
 */
export function getPlugins(): CLIPluginConfig[] {
  return store.get('plugins') ?? [];
}

/**
 * Add a plugin configuration
 */
export function addPlugin(config: CLIPluginConfig): void {
  const plugins = getPlugins();
  const source = config.package ?? config.path;

  // Check for duplicate
  const existing = plugins.findIndex(p => (p.package ?? p.path) === source);
  if (existing >= 0) {
    // Update existing
    plugins[existing] = config;
  } else {
    plugins.push(config);
  }

  store.set('plugins', plugins);
}

/**
 * Remove a plugin by package name or path
 */
export function removePlugin(packageOrPath: string): boolean {
  const plugins = getPlugins();
  const initialLength = plugins.length;

  const filtered = plugins.filter(p =>
    p.package !== packageOrPath && p.path !== packageOrPath
  );

  if (filtered.length < initialLength) {
    store.set('plugins', filtered);
    return true;
  }
  return false;
}

/**
 * Enable or disable a plugin
 */
export function setPluginEnabled(packageOrPath: string, enabled: boolean): boolean {
  const plugins = getPlugins();
  const plugin = plugins.find(p =>
    p.package === packageOrPath || p.path === packageOrPath
  );

  if (plugin) {
    plugin.enabled = enabled;
    store.set('plugins', plugins);
    return true;
  }
  return false;
}

/**
 * Clear all plugins
 */
export function clearPlugins(): void {
  store.set('plugins', []);
}
