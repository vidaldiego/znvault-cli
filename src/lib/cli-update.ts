// Path: znvault-cli/src/lib/cli-update.ts
/**
 * CLI Auto-Update Module
 *
 * Checks npm registry for updates and handles CLI self-update.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import React from 'react';
import { render } from 'ink';
import { UpdateBanner } from '../tui/components/UpdateBanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Package name on npm
const PACKAGE_NAME = '@zincapp/znvault-cli';

// Cache file for update check results
const UPDATE_CACHE_FILE = '.znvault-update-cache.json';

// How often to check for updates (24 hours)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateCache {
  lastCheck: number;
  latestVersion: string | null;
  currentVersion: string;
}

interface NpmPackageInfo {
  'dist-tags': {
    latest: string;
    [key: string]: string;
  };
  versions: Record<string, unknown>;
}

/**
 * Get the cache file path
 */
function getCacheFilePath(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  return path.join(homeDir, UPDATE_CACHE_FILE);
}

/**
 * Read update cache
 */
function readCache(): UpdateCache | null {
  try {
    const cachePath = getCacheFilePath();
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as UpdateCache;
      return data;
    }
  } catch {
    // Ignore cache read errors
  }
  return null;
}

/**
 * Write update cache
 */
function writeCache(cache: UpdateCache): void {
  try {
    const cachePath = getCacheFilePath();
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Get current CLI version from package.json
 */
export function getCurrentVersion(): string {
  const possiblePaths = [
    path.join(__dirname, '../package.json'),
    path.join(__dirname, '../../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8')) as { name?: string; version?: string };
        // Make sure it's our package
        if (pkg.name === PACKAGE_NAME && pkg.version) {
          return pkg.version;
        }
        // Fallback to any version found
        if (pkg.version) {
          return pkg.version;
        }
      }
    } catch {
      // Continue to next path
    }
  }

  return 'unknown';
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as NpmPackageInfo;
    const distTags = data['dist-tags'];
    return distTags.latest;
  } catch {
    return null;
  }
}

/**
 * Compare semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * Check if update is available
 * Uses cache to avoid checking on every command
 */
export async function checkForUpdate(forceCheck = false): Promise<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  fromCache: boolean;
}> {
  const currentVersion = getCurrentVersion();

  if (currentVersion === 'unknown') {
    return { updateAvailable: false, currentVersion, latestVersion: null, fromCache: false };
  }

  // Check cache first (unless forced)
  if (!forceCheck) {
    const cache = readCache();
    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      const updateAvailable = cache.latestVersion
        ? compareVersions(cache.latestVersion, currentVersion) > 0
        : false;

      return {
        updateAvailable,
        currentVersion,
        latestVersion: cache.latestVersion,
        fromCache: true,
      };
    }
  }

  // Fetch from npm registry
  const latestVersion = await fetchLatestVersion();

  // Update cache
  writeCache({
    lastCheck: Date.now(),
    latestVersion,
    currentVersion,
  });

  const updateAvailable = latestVersion
    ? compareVersions(latestVersion, currentVersion) > 0
    : false;

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    fromCache: false,
  };
}

/**
 * Perform the update using npm
 */
export async function performUpdate(options: {
  silent?: boolean;
  global?: boolean;
} = {}): Promise<{ success: boolean; error?: string }> {
  const { silent = false, global = true } = options;

  try {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', global ? '-g' : '', PACKAGE_NAME, '--no-fund', '--no-audit'].filter(Boolean);

    if (silent) {
      // Run synchronously and silently
      execSync(`${npmCommand} ${args.join(' ')}`, {
        stdio: 'ignore',
        timeout: 120000, // 2 minute timeout
      });
      return { success: true };
    }

    // Run with output
    return await new Promise((resolve) => {
      const child = spawn(npmCommand, args, {
        stdio: 'inherit',
        shell: true,
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `npm exited with code ${String(code ?? 'unknown')}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Update failed',
    };
  }
}

/**
 * Display update notification using Ink TUI
 */
export function showUpdateNotification(latestVersion: string, currentVersion: string): void {
  // Use Ink to render the update banner
  const { unmount } = render(
    React.createElement(UpdateBanner, {
      currentVersion,
      latestVersion,
      packageName: PACKAGE_NAME,
    })
  );

  // Unmount immediately after rendering (static output)
  unmount();
}

/**
 * Run update check in background (non-blocking)
 * Shows notification if update is available
 */
export function runBackgroundUpdateCheck(): void {
  // Don't check in CI environments
  if (process.env.CI || process.env.ZNVAULT_NO_UPDATE_CHECK) {
    return;
  }

  // Run check asynchronously without blocking
  void (async () => {
    try {
      const result = await checkForUpdate();
      const { latestVersion, currentVersion, updateAvailable } = result;
      if (updateAvailable && latestVersion) {
        // Delay notification slightly so it appears after command output
        setTimeout(() => {
          showUpdateNotification(latestVersion, currentVersion);
        }, 100);
      }
    } catch {
      // Silently ignore update check errors
    }
  })();
}

/**
 * Clear update cache (useful after manual update)
 */
export function clearUpdateCache(): void {
  try {
    const cachePath = getCacheFilePath();
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore errors
  }
}
