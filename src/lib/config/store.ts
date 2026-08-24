// Path: src/lib/config/store.ts

/**
 * Config store initialization
 *
 * Supports ZNVAULT_CONFIG_DIR environment variable for test isolation.
 * When set, config is stored in that directory instead of the default
 * OS-specific location (~/.config/znvault on Linux, ~/Library/Preferences on macOS).
 *
 * Uses lazy initialization to ensure mocks can be set up before store is created.
 */

import Conf from 'conf';
import type { ConfigStore } from './types.js';
import { DEFAULT_PROFILE } from './types.js';

// Lazy-initialized store instance
let _store: Conf<ConfigStore> | null = null;

/**
 * Get the config store instance (lazy initialization).
 * This allows mocks to be set up before the store is created.
 */
function getStoreInstance(): Conf<ConfigStore> {
  if (!_store) {
    // Check for custom config directory (used for test isolation)
    const configDir = process.env.ZNVAULT_CONFIG_DIR;

    _store = new Conf<ConfigStore>({
      projectName: 'znvault',
      // Profiles contain rotating access/refresh tokens. Preserve 0600 on
      // every atomic rewrite instead of inheriting a permissive process umask.
      configFileMode: 0o600,
      // Use custom config directory if specified (for test isolation)
      ...(configDir ? { cwd: configDir } : {}),
      defaults: {
        activeProfile: DEFAULT_PROFILE,
        profiles: {},
        plugins: [],
      },
    });
  }
  return _store;
}

/**
 * Store proxy that lazily initializes the underlying Conf instance.
 * This ensures mocks are applied before the real Conf is created.
 */
export const store: Conf<ConfigStore> = new Proxy({} as Conf<ConfigStore>, {
  get(_target, prop: keyof Conf<ConfigStore>) {
    const instance = getStoreInstance();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the very next lines bind any function to `instance` before returning it; that binding is this proxy's purpose
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, prop: keyof Conf<ConfigStore>, value: unknown) {
    const instance = getStoreInstance();
    (instance as unknown as Record<string, unknown>)[prop as string] = value;
    return true;
  },
});

// Runtime profile override (set via --profile flag)
let runtimeProfileOverride: string | null = null;

/**
 * Set runtime profile override (from --profile flag)
 */
export function setRuntimeProfile(profile: string | null): void {
  runtimeProfileOverride = profile;
}

/**
 * Get runtime profile override
 */
export function getRuntimeProfile(): string | null {
  return runtimeProfileOverride;
}

/**
 * Reset all configuration
 */
export function resetConfig(): void {
  store.clear();
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return store.path;
}

/**
 * Reset the store instance (for testing only)
 */
export function _resetStoreInstance(): void {
  _store = null;
  runtimeProfileOverride = null;
}
