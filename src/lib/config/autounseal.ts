// Path: src/lib/config/autounseal.ts

/**
 * Auto-unseal configuration
 *
 * Stores TOTP secret for automatic unseal (dev convenience).
 * The secret is stored securely using the OS keychain when available,
 * with fallback to config file storage (with warning).
 *
 * Storage priority:
 * 1. OS Keychain (macOS Keychain, Linux GNOME Keyring)
 * 2. Config file (fallback with security warning)
 */

import * as OTPAuth from 'otpauth';
import { getCurrentProfile, saveProfile, getActiveProfileName } from './profile.js';
import {
  isKeychainAvailable,
  keychainStore,
  keychainGet,
  keychainDelete,
} from './keychain.js';

/** Track if migration warning has been shown this session */
let migrationWarningShown = false;

/** Track if insecure storage warning has been shown this session */
let insecureStorageWarningShown = false;

/**
 * Get the keychain key for the current profile's auto-unseal secret
 */
function getKeychainKey(): string {
  const profileName = getActiveProfileName();
  return `auto-unseal:${profileName}`;
}

/**
 * Migrate secret from config file to keychain if needed
 * Returns true if migration was performed
 */
function migrateToKeychain(): boolean {
  const profile = getCurrentProfile();
  const legacySecret = profile.autoUnsealSecret;

  if (!legacySecret) {
    return false; // Nothing to migrate
  }

  if (!isKeychainAvailable()) {
    // Show warning once per session about insecure storage
    if (!insecureStorageWarningShown) {
      insecureStorageWarningShown = true;
      console.warn(
        '\x1b[33m⚠ Warning: OS keychain not available. TOTP secret is stored in plain text.\x1b[0m'
      );
      console.warn(
        '\x1b[33m  On macOS, this should not happen. On Linux, install secret-tool (gnome-keyring).\x1b[0m'
      );
    }
    return false;
  }

  // Migrate to keychain
  const key = getKeychainKey();
  if (keychainStore(key, legacySecret)) {
    // Remove from config file
    const profileName = getActiveProfileName();
    delete profile.autoUnsealSecret;
    saveProfile(profileName, profile);

    if (!migrationWarningShown) {
      migrationWarningShown = true;
      console.log('\x1b[32m✓ Auto-unseal secret migrated to secure OS keychain storage.\x1b[0m');
    }
    return true;
  }

  return false;
}

/**
 * Store auto-unseal TOTP secret for the current profile
 */
export function storeAutoUnsealSecret(secret: string): void {
  const normalizedSecret = normalizeSecret(secret);

  // Validate the secret by trying to create a TOTP instance
  try {
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(normalizedSecret),
    });
  } catch {
    throw new Error('Invalid TOTP secret. Must be a valid Base32 string.');
  }

  // Try to store in keychain first
  if (isKeychainAvailable()) {
    const key = getKeychainKey();
    if (keychainStore(key, normalizedSecret)) {
      // Ensure any legacy config file secret is removed
      const profile = getCurrentProfile();
      if (profile.autoUnsealSecret) {
        const profileName = getActiveProfileName();
        delete profile.autoUnsealSecret;
        saveProfile(profileName, profile);
      }
      return;
    }
  }

  // Fallback to config file storage (with warning)
  if (!insecureStorageWarningShown) {
    insecureStorageWarningShown = true;
    console.warn(
      '\x1b[33m⚠ Warning: Storing TOTP secret in config file (keychain unavailable).\x1b[0m'
    );
    console.warn(
      '\x1b[33m  This is less secure. Consider enabling OS keychain support.\x1b[0m'
    );
  }

  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  profile.autoUnsealSecret = normalizedSecret;
  saveProfile(profileName, profile);
}

/**
 * Get the stored auto-unseal TOTP secret for the current profile
 */
export function getAutoUnsealSecret(): string | undefined {
  // Try migration first (moves from config file to keychain)
  migrateToKeychain();

  // Try keychain first
  if (isKeychainAvailable()) {
    const key = getKeychainKey();
    const secret = keychainGet(key);
    if (secret) {
      return secret;
    }
  }

  // Fallback to config file
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
  // Clear from keychain
  if (isKeychainAvailable()) {
    const key = getKeychainKey();
    keychainDelete(key);
  }

  // Also clear from config file (in case of legacy storage)
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  if (profile.autoUnsealSecret) {
    delete profile.autoUnsealSecret;
    saveProfile(profileName, profile);
  }
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

/**
 * Check if secrets are stored securely (in keychain vs config file)
 */
export function isSecureStorageAvailable(): boolean {
  return isKeychainAvailable();
}
