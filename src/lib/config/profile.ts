// Path: src/lib/config/profile.ts

/**
 * Profile management operations
 */

import { store, getRuntimeProfile, withStoreMutation } from './store.js';
import { ensureMigrated } from './migration.js';
import { CONFIG_DEFAULTS, DEFAULT_PROFILE, type Profile, type ProfileInfo } from './types.js';
import { getCachedProfile, cacheProfile, invalidateProfileCache } from './cache.js';

function preserveAuthentication(current: Profile | undefined, proposed: Profile): Profile {
  const next = { ...proposed };
  if (current?.credentials !== undefined) next.credentials = current.credentials;
  else delete next.credentials;
  if (current?.apiKey !== undefined) next.apiKey = current.apiKey;
  else delete next.apiKey;
  if (current?.apiKeyId !== undefined) next.apiKeyId = current.apiKeyId;
  else delete next.apiKeyId;
  if (current?.apiKeyName !== undefined) next.apiKeyName = current.apiKeyName;
  else delete next.apiKeyName;
  return next;
}

/**
 * Get the current active profile name
 */
export function getActiveProfileName(): string {
  ensureMigrated();
  return getRuntimeProfile() ?? process.env.ZNVAULT_PROFILE ?? store.get('activeProfile');
}

/**
 * Get the current profile data (with caching)
 */
export function getCurrentProfile(): Profile {
  ensureMigrated();
  const profileName = getActiveProfileName();

  // Check cache first
  const cached = getCachedProfile(profileName);
  if (cached) return cached;

  // Load from store
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- needed for test mocks
  const profiles = store.get('profiles') ?? {};
  const profile = profiles[profileName] ?? {
    url: CONFIG_DEFAULTS.url,
    insecure: CONFIG_DEFAULTS.insecure,
    timeout: CONFIG_DEFAULTS.timeout,
  };

  // Cache for subsequent reads
  cacheProfile(profileName, profile);

  return profile;
}

/**
 * Save profile data (invalidates cache)
 */
export function saveProfile(profileName: string, profile: Profile): void {
  withStoreMutation(() => {
    const profiles = store.get('profiles');
    profiles[profileName] = preserveAuthentication(profiles[profileName], profile);
    store.set('profiles', profiles);
    invalidateProfileCache(profileName);
  });
}

/**
 * Atomically mutate authentication fields for exactly one existing profile.
 * Generic profile writes preserve these fields and cannot clobber them.
 */
export function mutateProfileAuthentication(
  profileName: string,
  mutation: (profile: Profile) => Profile,
): Profile {
  return withStoreMutation(() => {
    const profiles = store.get('profiles');
    const hasProfile = Object.prototype.hasOwnProperty.call(profiles, profileName);
    if (!hasProfile && profileName !== DEFAULT_PROFILE) {
      throw new Error(`Profile '${profileName}' not found`);
    }
    const current = hasProfile
      ? profiles[profileName]
      : {
          url: CONFIG_DEFAULTS.url,
          insecure: CONFIG_DEFAULTS.insecure,
          timeout: CONFIG_DEFAULTS.timeout,
        };
    const updated = mutation({ ...current });
    profiles[profileName] = updated;
    store.set('profiles', profiles);
    invalidateProfileCache(profileName);
    return updated;
  });
}

/**
 * List all profiles
 */
export function listProfiles(): ProfileInfo[] {
  const profiles = store.get('profiles');
  const activeProfile = getActiveProfileName();

  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    url: profile.url,
    active: name === activeProfile,
    hasCredentials: !!profile.credentials,
    hasApiKey: !!profile.apiKey,
  }));
}

/**
 * Names of every configured profile, sorted.
 */
export function listProfileNames(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- needed for test mocks
  const profiles = store.get('profiles') ?? {};
  return Object.keys(profiles).sort();
}

/**
 * Whether a profile with this exact name is configured.
 *
 * Used to fail closed on an explicitly requested profile that does not exist.
 * `getCurrentProfile()` deliberately falls back to CONFIG_DEFAULTS for a
 * missing profile so a fresh install still works; that fallback points at
 * localhost, which is the right default and the wrong answer when an operator
 * typed `--profile <name>` for a remote deployment.
 */
export function profileExists(name: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- needed for test mocks
  const profiles = store.get('profiles') ?? {};
  return Object.prototype.hasOwnProperty.call(profiles, name);
}

/**
 * Create a new profile
 */
export function createProfile(name: string, options: { url?: string; insecure?: boolean; copyFrom?: string }): void {
  withStoreMutation(() => {
    const profiles = store.get('profiles');

    if (name in profiles) {
      throw new Error(`Profile '${name}' already exists`);
    }

    let newProfile: Profile;

    if (options.copyFrom) {
      if (!(options.copyFrom in profiles)) {
        throw new Error(`Source profile '${options.copyFrom}' not found`);
      }
      newProfile = { ...profiles[options.copyFrom] };
      delete newProfile.credentials;
      delete newProfile.apiKey;
      delete newProfile.apiKeyId;
      delete newProfile.apiKeyName;
    } else {
      newProfile = {
        url: options.url ?? CONFIG_DEFAULTS.url,
        insecure: options.insecure ?? CONFIG_DEFAULTS.insecure,
        timeout: CONFIG_DEFAULTS.timeout,
      };
    }

    if (options.url) {
      newProfile.url = options.url;
    }
    if (options.insecure !== undefined) {
      newProfile.insecure = options.insecure;
    }

    profiles[name] = newProfile;
    store.set('profiles', profiles);
    invalidateProfileCache(name);
  });
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string): void {
  if (name === DEFAULT_PROFILE) {
    throw new Error(`Cannot delete the '${DEFAULT_PROFILE}' profile`);
  }

  withStoreMutation(() => {
    const profiles = store.get('profiles');
    if (!(name in profiles)) {
      throw new Error(`Profile '${name}' not found`);
    }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete profiles[name];
    store.set('profiles', profiles);
    invalidateProfileCache(name);
    if (store.get('activeProfile') === name) {
      store.set('activeProfile', DEFAULT_PROFILE);
    }
  });
}

/**
 * Switch active profile
 */
export function switchProfile(name: string): void {
  withStoreMutation(() => {
    const profiles = store.get('profiles');
    if (!(name in profiles)) {
      throw new Error(`Profile '${name}' not found`);
    }
    store.set('activeProfile', name);
  });
}

/**
 * Get a specific profile
 */
export function getProfile(name: string): Profile | undefined {
  const profiles = store.get('profiles');
  return profiles[name];
}

/**
 * Rename a profile
 */
export function renameProfile(oldName: string, newName: string): void {
  if (oldName === DEFAULT_PROFILE) {
    throw new Error(`Cannot rename the '${DEFAULT_PROFILE}' profile`);
  }

  withStoreMutation(() => {
    const profiles = store.get('profiles');
    if (!(oldName in profiles)) {
      throw new Error(`Profile '${oldName}' not found`);
    }
    if (newName in profiles) {
      throw new Error(`Profile '${newName}' already exists`);
    }
    profiles[newName] = profiles[oldName];
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete profiles[oldName];
    store.set('profiles', profiles);
    invalidateProfileCache(oldName);
    invalidateProfileCache(newName);
    if (store.get('activeProfile') === oldName) {
      store.set('activeProfile', newName);
    }
  });
}
