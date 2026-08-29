// Path: src/lib/config/apikey.ts

/**
 * API key storage operations
 */

import type { ApiKeyInfo } from './types.js';
import { getActiveProfileName, getCurrentProfile, mutateProfileAuthentication } from './profile.js';

/**
 * Check if we have API key authentication (env or stored in profile)
 */
export function hasApiKey(): boolean {
  return !!(process.env.ZNVAULT_API_KEY ?? getCurrentProfile().apiKey);
}

/**
 * Get API key (environment takes precedence over stored)
 */
export function getApiKey(): string | undefined {
  return process.env.ZNVAULT_API_KEY ?? getCurrentProfile().apiKey;
}

/**
 * Store API key in current profile
 */
export function storeApiKey(apiKey: string, keyId?: string, keyName?: string): void {
  const profileName = getActiveProfileName();
  mutateProfileAuthentication(profileName, (profile) => {
    if (profile.credentials) {
      throw new Error('Profile is configured for JWT authentication');
    }
    profile.apiKey = apiKey;
    if (keyId) profile.apiKeyId = keyId;
    if (keyName) profile.apiKeyName = keyName;
    return profile;
  });
}

/**
 * Get stored API key info from current profile
 */
export function getStoredApiKeyInfo(): ApiKeyInfo | undefined {
  const profile = getCurrentProfile();
  if (!profile.apiKey) return undefined;
  return {
    key: profile.apiKey,
    id: profile.apiKeyId,
    name: profile.apiKeyName,
  };
}

/**
 * Clear stored API key from current profile
 */
export function clearApiKey(): void {
  const profileName = getActiveProfileName();
  mutateProfileAuthentication(profileName, (profile) => {
    delete profile.apiKey;
    delete profile.apiKeyId;
    delete profile.apiKeyName;
    return profile;
  });
}

/**
 * Get stored API key from current profile
 */
export function getStoredApiKey(): string | undefined {
  return getCurrentProfile().apiKey;
}
