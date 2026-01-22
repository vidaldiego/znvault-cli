// Path: src/lib/config/cache.ts

/**
 * Config caching with TTL
 *
 * Caches profile data for a short period to avoid repeated disk reads
 * during burst operations (e.g., multiple API calls in quick succession).
 */

import type { Profile } from './types.js';
import { CONFIG_CACHE_TTL_MS } from '../constants.js';

/** Cache entry with timestamp */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/** Profile cache storage */
const profileCache = new Map<string, CacheEntry<Profile>>();

/** Config cache storage */
let configCache: CacheEntry<Record<string, unknown>> | null = null;

/**
 * Get a cached profile or undefined if not cached/expired
 */
export function getCachedProfile(profileName: string): Profile | undefined {
  const entry = profileCache.get(profileName);
  if (!entry) return undefined;

  if (Date.now() - entry.timestamp > CONFIG_CACHE_TTL_MS) {
    profileCache.delete(profileName);
    return undefined;
  }

  return entry.value;
}

/**
 * Cache a profile
 */
export function cacheProfile(profileName: string, profile: Profile): void {
  profileCache.set(profileName, {
    value: profile,
    timestamp: Date.now(),
  });
}

/**
 * Invalidate a specific profile cache
 */
export function invalidateProfileCache(profileName: string): void {
  profileCache.delete(profileName);
}

/**
 * Invalidate all profile caches
 */
export function invalidateAllProfileCaches(): void {
  profileCache.clear();
}

/**
 * Get cached config or undefined if not cached/expired
 */
export function getCachedConfig(): Record<string, unknown> | undefined {
  if (!configCache) return undefined;

  if (Date.now() - configCache.timestamp > CONFIG_CACHE_TTL_MS) {
    configCache = null;
    return undefined;
  }

  return configCache.value;
}

/**
 * Cache the config
 */
export function cacheConfig(config: Record<string, unknown>): void {
  configCache = {
    value: config,
    timestamp: Date.now(),
  };
}

/**
 * Invalidate config cache
 */
export function invalidateConfigCache(): void {
  configCache = null;
}

/**
 * Invalidate all caches (profiles and config)
 */
export function invalidateAllCaches(): void {
  invalidateAllProfileCaches();
  invalidateConfigCache();
}

/**
 * Get cache statistics (for debugging/testing)
 */
export function getCacheStats(): { profileCacheSize: number; hasConfigCache: boolean } {
  return {
    profileCacheSize: profileCache.size,
    hasConfigCache: configCache !== null,
  };
}
