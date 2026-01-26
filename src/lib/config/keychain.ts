// Path: src/lib/config/keychain.ts

/**
 * OS Keychain Integration
 *
 * Provides secure storage for sensitive data using the OS keychain.
 * - macOS: Uses the `security` CLI to access Keychain
 * - Linux: Uses `secret-tool` if available (GNOME Keyring)
 * - Windows/Fallback: Returns null (caller should use encrypted file storage)
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';

const SERVICE_NAME = 'znvault-cli';

/**
 * Check if keychain is available on this platform
 */
export function isKeychainAvailable(): boolean {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS - security command is always available
    return true;
  }

  if (platform === 'linux') {
    // Linux - check for secret-tool (GNOME Keyring)
    try {
      execFileSync('which', ['secret-tool'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      return true;
    } catch {
      return false;
    }
  }

  // Windows and other platforms - not supported yet
  return false;
}

/**
 * Store a secret in the OS keychain
 *
 * @param key - The key/account name for the secret
 * @param value - The secret value to store
 * @returns true if stored successfully, false if keychain not available
 */
export function keychainStore(key: string, value: string): boolean {
  const platform = os.platform();

  if (platform === 'darwin') {
    return macOSKeychainStore(key, value);
  }

  if (platform === 'linux') {
    return linuxKeychainStore(key, value);
  }

  return false;
}

/**
 * Retrieve a secret from the OS keychain
 *
 * @param key - The key/account name for the secret
 * @returns The secret value, or null if not found or keychain not available
 */
export function keychainGet(key: string): string | null {
  const platform = os.platform();

  if (platform === 'darwin') {
    return macOSKeychainGet(key);
  }

  if (platform === 'linux') {
    return linuxKeychainGet(key);
  }

  return null;
}

/**
 * Delete a secret from the OS keychain
 *
 * @param key - The key/account name for the secret
 * @returns true if deleted successfully, false otherwise
 */
export function keychainDelete(key: string): boolean {
  const platform = os.platform();

  if (platform === 'darwin') {
    return macOSKeychainDelete(key);
  }

  if (platform === 'linux') {
    return linuxKeychainDelete(key);
  }

  return false;
}

// --- macOS Implementation ---

function macOSKeychainStore(key: string, value: string): boolean {
  try {
    // First try to delete any existing entry (ignore errors)
    macOSKeychainDelete(key);

    // Add new entry to keychain
    execFileSync('security', [
      'add-generic-password',
      '-a', key,           // Account name
      '-s', SERVICE_NAME,  // Service name
      '-w', value,         // Password/secret value
      '-U',                // Update if exists
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

function macOSKeychainGet(key: string): string | null {
  try {
    const result = execFileSync('security', [
      'find-generic-password',
      '-a', key,           // Account name
      '-s', SERVICE_NAME,  // Service name
      '-w',                // Output only the password
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return result.trim();
  } catch {
    return null;
  }
}

function macOSKeychainDelete(key: string): boolean {
  try {
    execFileSync('security', [
      'delete-generic-password',
      '-a', key,           // Account name
      '-s', SERVICE_NAME,  // Service name
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

// --- Linux Implementation (GNOME Keyring via secret-tool) ---

function linuxKeychainStore(key: string, value: string): boolean {
  try {
    // secret-tool reads the secret from stdin
    execFileSync('secret-tool', [
      'store',
      '--label', `${SERVICE_NAME}: ${key}`,
      'service', SERVICE_NAME,
      'account', key,
    ], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

function linuxKeychainGet(key: string): string | null {
  try {
    const result = execFileSync('secret-tool', [
      'lookup',
      'service', SERVICE_NAME,
      'account', key,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return result.trim();
  } catch {
    return null;
  }
}

function linuxKeychainDelete(key: string): boolean {
  try {
    execFileSync('secret-tool', [
      'clear',
      'service', SERVICE_NAME,
      'account', key,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}
