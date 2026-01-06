import Conf from 'conf';
import type { CLIConfig, StoredCredentials, FullConfig } from '../types/index.js';

const CONFIG_DEFAULTS: CLIConfig = {
  url: 'https://localhost:8443',
  insecure: false,
  timeout: 30000,
};

const DEFAULT_PROFILE = 'default';

export interface Profile {
  url: string;
  insecure: boolean;
  timeout: number;
  defaultTenant?: string;
  credentials?: StoredCredentials;
  apiKey?: string;  // Stored API key for this profile
  apiKeyId?: string;  // API key ID (for revocation on logout)
  apiKeyName?: string;  // API key name (for display)
}

interface ConfigStore {
  activeProfile: string;
  profiles: Record<string, Profile>;
  // Legacy fields for migration
  url?: string;
  insecure?: boolean;
  timeout?: number;
  defaultTenant?: string;
  credentials?: StoredCredentials;
}

const store = new Conf<ConfigStore>({
  projectName: 'znvault',
  defaults: {
    activeProfile: DEFAULT_PROFILE,
    profiles: {},
  },
});

// Runtime profile override (set via --profile flag)
let runtimeProfileOverride: string | null = null;

/**
 * Set runtime profile override (from --profile flag)
 */
export function setRuntimeProfile(profile: string | null): void {
  runtimeProfileOverride = profile;
}

/**
 * Get the current active profile name
 */
export function getActiveProfileName(): string {
  return runtimeProfileOverride ?? process.env.ZNVAULT_PROFILE ?? store.get('activeProfile');
}

/**
 * Migrate legacy config to profile-based config
 */
function migrateIfNeeded(): void {
  // Check if we have legacy config (url at root level but no profiles)
  const legacyUrl = store.get('url');
  const profiles = store.get('profiles');

  if (legacyUrl && Object.keys(profiles).length === 0) {
    // Migrate legacy config to default profile
    const defaultProfile: Profile = {
      url: legacyUrl,
      insecure: store.get('insecure') ?? CONFIG_DEFAULTS.insecure,
      timeout: store.get('timeout') ?? CONFIG_DEFAULTS.timeout,
      defaultTenant: store.get('defaultTenant'),
      credentials: store.get('credentials'),
    };

    store.set('profiles', { [DEFAULT_PROFILE]: defaultProfile });
    store.set('activeProfile', DEFAULT_PROFILE);

    // Clean up legacy keys
    store.delete('url');
    store.delete('insecure');
    store.delete('timeout');
    store.delete('defaultTenant');
    store.delete('credentials');
  }
}

// Run migration on module load
migrateIfNeeded();

/**
 * Get the current profile data
 */
function getCurrentProfile(): Profile {
  const profileName = getActiveProfileName();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- needed for test mocks
  const profiles = store.get('profiles') ?? {};
  return profiles[profileName] ?? {
    url: CONFIG_DEFAULTS.url,
    insecure: CONFIG_DEFAULTS.insecure,
    timeout: CONFIG_DEFAULTS.timeout,
  };
}

/**
 * Save profile data
 */
function saveProfile(profileName: string, profile: Profile): void {
  const profiles = store.get('profiles');
  profiles[profileName] = profile;
  store.set('profiles', profiles);
}

/**
 * Get configuration value with priority:
 * 1. Environment variable
 * 2. Current profile config
 * 3. Default value
 */
export function getConfig(): FullConfig {
  const envUrl = process.env.ZNVAULT_URL;
  const envInsecure = process.env.ZNVAULT_INSECURE;
  const envTimeout = process.env.ZNVAULT_TIMEOUT;

  const profile = getCurrentProfile();

  return {
    url: envUrl ?? profile.url,
    insecure: envInsecure === 'true' || profile.insecure,
    timeout: envTimeout ? parseInt(envTimeout, 10) : profile.timeout,
    defaultTenant: profile.defaultTenant,
    credentials: profile.credentials,
  };
}

/**
 * Get a specific config value
 */
export function getConfigValue<K extends keyof FullConfig>(key: K): FullConfig[K] {
  return getConfig()[key];
}

/**
 * Set a config value in the current profile
 */
export function setConfigValue<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();

  // Type-safe assignment using a properly typed intermediate object
  const updatedProfile: Profile = {
    ...profile,
    [key]: value,
  };

  saveProfile(profileName, updatedProfile);
}

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
  // Add 60 second buffer
  return Date.now() >= (credentials.expiresAt - 60000);
}

/**
 * Get the effective URL (from env or config)
 */
export function getEffectiveUrl(): string {
  return process.env.ZNVAULT_URL ?? getCurrentProfile().url;
}

/**
 * Check if we have API key authentication (env or stored in profile)
 */
export function hasApiKey(): boolean {
  return !!(process.env.ZNVAULT_API_KEY ?? getCurrentProfile().apiKey);
}

/**
 * Get API key (environment takes precedence over stored)
 */
export function getApiKey(): string | undefined {
  return process.env.ZNVAULT_API_KEY ?? getCurrentProfile().apiKey;
}

/**
 * Store API key in current profile
 */
export function storeApiKey(apiKey: string, keyId?: string, keyName?: string): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  profile.apiKey = apiKey;
  if (keyId) profile.apiKeyId = keyId;
  if (keyName) profile.apiKeyName = keyName;
  saveProfile(profileName, profile);
}

/**
 * Get stored API key info from current profile
 */
export function getStoredApiKeyInfo(): { key: string; id?: string; name?: string } | undefined {
  const profile = getCurrentProfile();
  if (!profile.apiKey) return undefined;
  return {
    key: profile.apiKey,
    id: profile.apiKeyId,
    name: profile.apiKeyName,
  };
}

/**
 * Clear stored API key from current profile
 */
export function clearApiKey(): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  delete profile.apiKey;
  delete profile.apiKeyId;
  delete profile.apiKeyName;
  saveProfile(profileName, profile);
}

/**
 * Get stored API key from current profile
 */
export function getStoredApiKey(): string | undefined {
  return getCurrentProfile().apiKey;
}

/**
 * Check if we have username/password in environment
 */
export function hasEnvCredentials(): boolean {
  return !!(process.env.ZNVAULT_USERNAME && process.env.ZNVAULT_PASSWORD);
}

/**
 * Get credentials from environment
 */
export function getEnvCredentials(): { username: string; password: string } | undefined {
  const username = process.env.ZNVAULT_USERNAME;
  const password = process.env.ZNVAULT_PASSWORD;
  if (username && password) {
    return { username, password };
  }
  return undefined;
}

/**
 * Reset all configuration
 */
export function resetConfig(): void {
  store.clear();
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return store.path;
}

/**
 * Get all stored config (for display)
 */
export function getAllConfig(): Record<string, unknown> {
  const profile = getCurrentProfile();
  return {
    activeProfile: getActiveProfileName(),
    url: profile.url,
    insecure: profile.insecure,
    timeout: profile.timeout,
    defaultTenant: profile.defaultTenant,
    hasCredentials: !!profile.credentials,
    hasApiKey: !!profile.apiKey,
    apiKeyPrefix: profile.apiKey ? profile.apiKey.substring(0, 12) + '...' : undefined,
    configPath: store.path,
  };
}

// ============================================================================
// Profile Management
// ============================================================================

/**
 * List all profiles
 */
export function listProfiles(): Array<{ name: string; url: string; active: boolean; hasCredentials: boolean; hasApiKey: boolean }> {
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
 * Create a new profile
 */
export function createProfile(name: string, options: { url?: string; insecure?: boolean; copyFrom?: string }): void {
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
    // Don't copy credentials
    newProfile.credentials = undefined;
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
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string): void {
  if (name === DEFAULT_PROFILE) {
    throw new Error(`Cannot delete the '${DEFAULT_PROFILE}' profile`);
  }

  const profiles = store.get('profiles');

  if (!(name in profiles)) {
    throw new Error(`Profile '${name}' not found`);
  }

  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete profiles[name];
  store.set('profiles', profiles);

  // If we deleted the active profile, switch to default
  if (store.get('activeProfile') === name) {
    store.set('activeProfile', DEFAULT_PROFILE);
  }
}

/**
 * Switch active profile
 */
export function switchProfile(name: string): void {
  const profiles = store.get('profiles');

  if (!(name in profiles)) {
    throw new Error(`Profile '${name}' not found`);
  }

  store.set('activeProfile', name);
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

  // Update active profile if needed
  if (store.get('activeProfile') === oldName) {
    store.set('activeProfile', newName);
  }
}
