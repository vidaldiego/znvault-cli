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
import { withProfileMutationLock } from './profile-lock.js';

// Lazy-initialized store instance
let _store: Conf<ConfigStore> | null = null;

function storeOptions(includeDefaults: boolean): {
  projectName: string;
  configFileMode: number;
  cwd?: string;
  defaults?: ConfigStore;
} {
  const configDir = process.env.ZNVAULT_CONFIG_DIR;
  return {
    projectName: 'znvault',
    configFileMode: 0o600,
    ...(configDir ? { cwd: configDir } : {}),
    ...(includeDefaults
      ? {
          defaults: {
            activeProfile: DEFAULT_PROFILE,
            profiles: {},
            plugins: [],
          },
        }
      : {}),
  };
}

function resolveConfigPath(): string {
  // A Conf instance without defaults only resolves/reads the path; it cannot
  // create or rewrite the JSON file during construction.
  return new Conf<ConfigStore>(storeOptions(false)).path;
}

/**
 * Get the config store instance (lazy initialization).
 * This allows mocks to be set up before the store is created.
 */
function getStoreInstance(): Conf<ConfigStore> {
  if (!_store) {
    const configPath = resolveConfigPath();
    _store = withProfileMutationLock(
      configPath,
      () => new Conf<ConfigStore>(storeOptions(true)),
    );
  }
  return _store;
}

/**
 * Run a complete read-modify-write transaction against the shared config
 * file. Every mutation must use this authority so another CLI process cannot
 * rewrite a stale whole-file snapshot over profile authentication.
 */
export function withStoreMutation<T>(operation: () => T): T {
  const instance = getStoreInstance();
  return withProfileMutationLock(instance.path, operation);
}

const MUTATING_STORE_METHODS = new Set<PropertyKey>([
  'set',
  'delete',
  'clear',
  'reset',
  'appendToArray',
]);

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
      const bound = value.bind(instance) as (...args: unknown[]) => unknown;
      if (MUTATING_STORE_METHODS.has(prop)) {
        return (...args: unknown[]) => withStoreMutation(() => bound(...args));
      }
      return bound;
    }
    return value;
  },
  set(_target, prop: keyof Conf<ConfigStore>, value: unknown) {
    if (prop === 'store') {
      throw new Error('Direct CLI config store replacement is forbidden');
    }
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
