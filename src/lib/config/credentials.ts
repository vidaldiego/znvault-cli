// Path: src/lib/config/credentials.ts

/**
 * Credential management operations
 */

import type { StoredCredentials } from '../../types/index.js';
import { getActiveProfileName, getCurrentProfile, saveProfile } from './profile.js';
import { TOKEN_REFRESH_BUFFER_MS } from '../constants.js';

/**
 * Store credentials after login
 */
export function storeCredentials(credentials: StoredCredentials): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  profile.credentials = credentials;
  saveProfile(profileName, profile);
}

/**
 * Clear stored credentials
 */
export function clearCredentials(): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  delete profile.credentials;
  saveProfile(profileName, profile);
}

/**
 * Get stored credentials
 */
export function getCredentials(): StoredCredentials | undefined {
  return getCurrentProfile().credentials;
}

/**
 * Check if credentials are expired
 */
export function isTokenExpired(): boolean {
  const credentials = getCredentials();
  if (!credentials) return true;
  // Add buffer before expiry to refresh proactively
  return Date.now() >= (credentials.expiresAt - TOKEN_REFRESH_BUFFER_MS);
}

/**
 * Check if we have username/password in environment
 */
export function hasEnvCredentials(): boolean {
  const username = process.env.ZNVAULT_USERNAME;
  const password = process.env.ZNVAULT_PASSWORD;
  // Must have both and username must not be empty
  return !!(username && username.trim() !== '' && password !== undefined);
}

/**
 * Get credentials from environment with validation
 * Returns undefined if not set, throws if partially set or invalid
 */
export function getEnvCredentials(): { username: string; password: string } | undefined {
  const username = process.env.ZNVAULT_USERNAME;
  const password = process.env.ZNVAULT_PASSWORD;

  // Not set at all
  if (username === undefined && password === undefined) {
    return undefined;
  }

  // Validate: both must be set
  if (username === undefined) {
    throw new Error('ZNVAULT_PASSWORD is set but ZNVAULT_USERNAME is missing');
  }
  if (password === undefined) {
    throw new Error('ZNVAULT_USERNAME is set but ZNVAULT_PASSWORD is missing');
  }

  // Validate: username cannot be empty
  if (username.trim() === '') {
    throw new Error('ZNVAULT_USERNAME is set but empty');
  }

  return { username, password };
}
