// Path: src/lib/config/store.ts

/**
 * Config store initialization
 */

import Conf from 'conf';
import type { ConfigStore } from './types.js';
import { DEFAULT_PROFILE } from './types.js';

export const store = new Conf<ConfigStore>({
  projectName: 'znvault',
  defaults: {
    activeProfile: DEFAULT_PROFILE,
    profiles: {},
    plugins: [],
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
