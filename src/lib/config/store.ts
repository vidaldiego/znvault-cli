// Path: src/lib/config/store.ts

/**
 * Config store initialization
 *
 * Supports ZNVAULT_CONFIG_DIR environment variable for test isolation.
 * When set, config is stored in that directory instead of the default
 * OS-specific location (~/.config/znvault on Linux, ~/Library/Preferences on macOS).
 */

import Conf from 'conf';
import type { ConfigStore } from './types.js';
import { DEFAULT_PROFILE } from './types.js';

// Check for custom config directory (used for test isolation)
const configDir = process.env.ZNVAULT_CONFIG_DIR;

export const store = new Conf<ConfigStore>({
  projectName: 'znvault',
  // Use custom config directory if specified (for test isolation)
  ...(configDir ? { cwd: configDir } : {}),
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
