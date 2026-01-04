// Path: znvault-cli/src/services/update-checker.ts

/**
 * Update Checker Service
 *
 * Checks for new agent versions by fetching manifests from S3.
 * Compares versions using semantic versioning.
 */

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentManifest,
  UpdateCheckResult,
  UpdateChannel,
} from '../types/update.js';
import { getManifestUrl } from '../types/update.js';
import { getPlatform, getConfigDir } from '../utils/platform.js';

/**
 * Parse a semantic version string into components
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return { major: 0, minor: 0, patch: 0 };
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

/**
 * Check if version a is newer than version b
 */
function isNewerVersion(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

interface VersionCacheData {
  version: string;
  channel?: string;
  checkedAt?: string;
}

export class UpdateChecker {
  private channel: UpdateChannel;
  private cachedManifest: AgentManifest | null = null;
  private lastCheck: Date | null = null;
  private cacheTimeout = 60000; // 1 minute cache

  constructor(channel: UpdateChannel = 'stable') {
    this.channel = channel;
  }

  /**
   * Set the update channel
   */
  setChannel(channel: UpdateChannel): void {
    if (this.channel !== channel) {
      this.channel = channel;
      this.cachedManifest = null; // Invalidate cache on channel change
    }
  }

  /**
   * Fetch manifest from S3
   */
  private async fetchManifest(): Promise<AgentManifest> {
    // Check cache
    if (this.cachedManifest && this.lastCheck) {
      const elapsed = Date.now() - this.lastCheck.getTime();
      if (elapsed < this.cacheTimeout) {
        return this.cachedManifest;
      }
    }

    const url = getManifestUrl(this.channel);

    return new Promise((resolve, reject) => {
      https.get(url, { rejectUnauthorized: true }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch manifest: HTTP ${String(res.statusCode)}`));
          return;
        }

        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const manifest = JSON.parse(data) as AgentManifest;
            this.cachedManifest = manifest;
            this.lastCheck = new Date();
            resolve(manifest);
          } catch (err) {
            reject(new Error(`Failed to parse manifest: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
    try {
      const manifest = await this.fetchManifest();
      const platform = getPlatform();

      // Handle unsupported platform
      if (platform === 'unsupported') {
        return {
          updateAvailable: false,
          currentVersion,
          latestVersion: manifest.version,
          error: `Unsupported platform: ${process.platform}/${process.arch}`,
        };
      }

      // Check if update is available
      const updateAvailable = isNewerVersion(manifest.version, currentVersion);

      // Check minimum version requirement
      if (updateAvailable && manifest.minVersion) {
        if (compareVersions(currentVersion, manifest.minVersion) < 0) {
          return {
            updateAvailable: false,
            currentVersion,
            latestVersion: manifest.version,
            error: `Current version ${currentVersion} is too old. Minimum required: ${manifest.minVersion}. Please update manually.`,
          };
        }
      }

      const artifact = manifest.artifacts[platform];

      return {
        updateAvailable,
        currentVersion,
        latestVersion: manifest.version,
        manifest: updateAvailable ? manifest : undefined,
        artifact: updateAvailable ? artifact : undefined,
      };
    } catch (err) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: 'unknown',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get the cached manifest if available
   */
  getCachedManifest(): AgentManifest | null {
    return this.cachedManifest;
  }

  /**
   * Force refresh the manifest cache
   */
  async refreshManifest(): Promise<AgentManifest> {
    this.cachedManifest = null;
    this.lastCheck = null;
    return this.fetchManifest();
  }

  /**
   * Save the last known version to cache file
   * Used for persistent tracking between daemon restarts
   */
  saveLastKnownVersion(version: string): void {
    const cacheFile = path.join(getConfigDir(), 'last-version.json');
    const data: VersionCacheData = {
      version,
      channel: this.channel,
      checkedAt: new Date().toISOString(),
    };

    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load the last known version from cache file
   */
  loadLastKnownVersion(): string | null {
    const cacheFile = path.join(getConfigDir(), 'last-version.json');

    try {
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as VersionCacheData;
        return data.version;
      }
    } catch {
      // Ignore errors reading cache
    }

    return null;
  }
}

// Factory function
export function createUpdateChecker(channel: UpdateChannel = 'stable'): UpdateChecker {
  return new UpdateChecker(channel);
}
