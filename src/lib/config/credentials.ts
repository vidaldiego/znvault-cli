// Path: src/lib/config/credentials.ts

/**
 * Credential management operations
 */

import type { StoredCredentials } from '../../types/index.js';
import { getActiveProfileName, getCurrentProfile, saveProfile } from './profile.js';
import { TOKEN_REFRESH_BUFFER_MS, PENDING_REFRESH_TTL } from '../constants.js';
import { debug } from '../debug.js';

/**
 * Store credentials after login/refresh.
 *
 * The whole credentials object is replaced in ONE profile write, so omitting
 * `pendingRefresh` clears any existing marker atomically (design §A.1) — the
 * marker is never cleared in a separate, crash-exposed write.
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
 * Decode the `jti` claim from a refresh JWT (payload segment, no signature
 * check — this is a local read for the crash-recovery marker, not auth). Returns
 * null on any parse failure (design §A.1 / C2: the marker stores the real jti).
 */
export function decodeRefreshJti(refreshToken: string): string | null {
  try {
    const seg = refreshToken.split('.')[1];
    if (!seg) return null;
    const payload = JSON.parse(Buffer.from(seg, 'base64url').toString()) as { jti?: unknown };
    return typeof payload.jti === 'string' ? payload.jti : null;
  } catch {
    return null;
  }
}

/**
 * Atomically mark a refresh as in-flight (write-ahead intent). Returns false
 * if there are no credentials to mark. While a marker is present the marked
 * token must NEVER be presented (design §A.1). presentedJti is the real jti.
 */
export function writePendingRefreshMarker(presentedJti: string): boolean {
  const credentials = getCredentials();
  if (!credentials) return false;
  storeCredentials({
    ...credentials,
    pendingRefresh: { presentedJti, startedAt: Date.now() },
  });
  return true;
}

export type MarkerDecision =
  | { action: 'none' }
  | { action: 'resolve-live' }
  | { action: 'clean-relogin'; reason: 'marker_past_ttl' };

/**
 * Persistent-marker model (design §A.1): the marker is never silently deleted.
 * - no marker             -> 'none'
 * - marker within TTL     -> 'resolve-live' (refresh the live token; that write clears it)
 * - marker older than TTL -> 'clean-relogin' (the marked token is still never presented)
 */
export function decidePendingRefresh(now: number = Date.now()): MarkerDecision {
  const credentials = getCredentials();
  const marker = credentials?.pendingRefresh;
  if (!marker) return { action: 'none' };
  if (now - marker.startedAt >= PENDING_REFRESH_TTL) {
    return { action: 'clean-relogin', reason: 'marker_past_ttl' };
  }
  return { action: 'resolve-live' };
}

/**
 * Client-side observability log (design §A.1 / §5.2(d), A3): emitted whenever a
 * marker triggers a clean re-login, so the recovery rate is observable. A spike
 * means something is crashing/failing mid-refresh.
 */
export function logPendingRefreshRecovery(reason: string): void {
  debug('pending_refresh_recovery', `marker-triggered re-login (reason=${reason})`);
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
