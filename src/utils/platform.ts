// Path: znvault-cli/src/utils/platform.ts

/**
 * Platform Detection Utilities
 *
 * Detects the current platform and architecture for downloading
 * the correct agent binary during updates.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Platform } from '../types/update.js';

/**
 * Detect the current platform for binary downloads
 * Returns 'unsupported' for non-Linux platforms
 */
export function getPlatform(): Platform | 'unsupported' {
  const platform = process.platform;
  const arch = process.arch;

  if (platform !== 'linux') {
    return 'unsupported';
  }

  if (arch === 'x64') {
    return 'linux_amd64';
  }

  if (arch === 'arm64') {
    return 'linux_arm64';
  }

  return 'unsupported';
}

/**
 * Get human-readable platform name
 */
export function getPlatformName(): string {
  const platform = getPlatform();

  switch (platform) {
    case 'linux_amd64':
      return 'Linux (x86_64)';
    case 'linux_arm64':
      return 'Linux (ARM64)';
    default:
      return `${process.platform} (${process.arch}) - unsupported`;
  }
}

/**
 * Standard installation paths to check
 */
const INSTALL_PATHS = [
  '/opt/znvault/current/bin/znvault',
  '/usr/local/bin/znvault',
  '/usr/bin/znvault',
];

/**
 * Get the installation path of the current znvault binary
 */
export function getInstallPath(): string {
  // First, check if we're running from a known location
  const execPath = process.execPath;

  // If running via node, try to find the actual script location
  if (execPath.includes('node')) {
    // Check standard locations
    for (const p of INSTALL_PATHS) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    // Default to /usr/local/bin for fresh installs
    return '/usr/local/bin/znvault';
  }

  // Running as standalone binary, use current executable path
  return execPath;
}

/**
 * Check if the current process has write access to the install path
 */
export function canWriteToInstallPath(installPath?: string): boolean {
  const targetPath = installPath || getInstallPath();
  const targetDir = path.dirname(targetPath);

  try {
    // Check if directory exists and is writable
    fs.accessSync(targetDir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if running as root (required for system-wide installs)
 */
export function isRoot(): boolean {
  return process.getuid?.() === 0;
}

/**
 * Get temporary directory for downloads
 */
export function getTempDir(): string {
  return os.tmpdir();
}

/**
 * Get the home directory for config files
 */
export function getConfigDir(): string {
  const home = os.homedir();
  return path.join(home, '.znvault');
}

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): string {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}
