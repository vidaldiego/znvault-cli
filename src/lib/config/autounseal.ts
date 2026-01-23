// Path: src/lib/config/autounseal.ts

/**
 * Auto-unseal configuration
 *
 * Stores TOTP secret for automatic unseal (dev convenience).
 * The secret is stored per-profile and used to generate TOTP codes
 * without requiring manual entry.
 */

import * as OTPAuth from 'otpauth';
import { getCurrentProfile, saveProfile, getActiveProfileName } from './profile.js';

/**
 * Store auto-unseal TOTP secret for the current profile
 */
export function storeAutoUnsealSecret(secret: string): void {
  // Validate the secret by trying to create a TOTP instance
  try {
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(normalizeSecret(secret)),
    });
  } catch {
    throw new Error('Invalid TOTP secret. Must be a valid Base32 string.');
  }

  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  profile.autoUnsealSecret = normalizeSecret(secret);
  saveProfile(profileName, profile);
}

/**
 * Get the stored auto-unseal TOTP secret for the current profile
 */
export function getAutoUnsealSecret(): string | undefined {
  const profile = getCurrentProfile();
  return profile.autoUnsealSecret;
}

/**
 * Check if auto-unseal is configured for the current profile
 */
export function hasAutoUnsealSecret(): boolean {
  return !!getAutoUnsealSecret();
}

/**
 * Clear the auto-unseal secret for the current profile
 */
export function clearAutoUnsealSecret(): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  delete profile.autoUnsealSecret;
  saveProfile(profileName, profile);
}

/**
 * Generate a TOTP code using the stored secret
 *
 * @returns The current 6-digit TOTP code
 * @throws Error if no auto-unseal secret is configured
 */
export function generateTOTPCode(): string {
  const secret = getAutoUnsealSecret();
  if (!secret) {
    throw new Error('No auto-unseal secret configured. Run "znvault unseal setup-auto" first.');
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'ZnVault',
    label: 'AutoUnseal',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  return totp.generate();
}

/**
 * Normalize a TOTP secret (remove spaces, uppercase)
 */
function normalizeSecret(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase();
}

/**
 * Parse a TOTP URI (otpauth://totp/...) and extract the secret
 */
export function parseOTPAuthURI(uri: string): string {
  try {
    const totp = OTPAuth.URI.parse(uri);
    if (!(totp instanceof OTPAuth.TOTP)) {
      throw new Error('URI is not a TOTP URI');
    }
    return totp.secret.base32;
  } catch (err) {
    throw new Error(`Invalid otpauth URI: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}
