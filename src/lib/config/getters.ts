// Path: src/lib/config/getters.ts

/**
 * Config getters and setters
 */

import type { CLIConfig, FullConfig } from '../../types/index.js';
import { getConfigPath } from './store.js';
import { getActiveProfileName, getCurrentProfile, saveProfile } from './profile.js';

/**
 * Get configuration value with priority:
 * 1. Environment variable
 * 2. Current profile config
 * 3. Default value
 */
export function getConfig(): FullConfig {
  const envUrl = process.env.ZNVAULT_URL;
  const envInsecure = process.env.ZNVAULT_INSECURE;
  const envTimeout = process.env.ZNVAULT_TIMEOUT;

  const profile = getCurrentProfile();

  return {
    url: envUrl ?? profile.url,
    insecure: envInsecure === 'true' || profile.insecure,
    timeout: envTimeout ? parseInt(envTimeout, 10) : profile.timeout,
    defaultTenant: profile.defaultTenant,
    credentials: profile.credentials,
  };
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof FullConfig>(key: K): FullConfig[K] {
  return getConfig()[key];
}

/**
 * Set a config value in the current profile
 */
export function setConfigValue<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();

  // Type-safe assignment using a properly typed intermediate object
  const updatedProfile = {
    ...profile,
    [key]: value,
  };

  saveProfile(profileName, updatedProfile);
}

/**
 * Get the effective URL (from env or config)
 */
export function getEffectiveUrl(): string {
  return process.env.ZNVAULT_URL ?? getCurrentProfile().url;
}

/**
 * Get all stored config (for display)
 */
export function getAllConfig(): Record<string, unknown> {
  const profile = getCurrentProfile();
  return {
    activeProfile: getActiveProfileName(),
    url: profile.url,
    insecure: profile.insecure,
    timeout: profile.timeout,
    defaultTenant: profile.defaultTenant,
    hasCredentials: !!profile.credentials,
    hasApiKey: !!profile.apiKey,
    apiKeyPrefix: profile.apiKey ? profile.apiKey.substring(0, 12) + '...' : undefined,
    configPath: getConfigPath(),
  };
}
