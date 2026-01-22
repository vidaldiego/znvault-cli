// Path: src/lib/config/types.ts

/**
 * Config module types
 */

import type { StoredCredentials } from '../../types/index.js';
import type { CLIPluginConfig } from '../../plugins/types.js';

export const CONFIG_DEFAULTS = {
  url: 'https://localhost:8443',
  insecure: false,
  timeout: 30000,
} as const;

export const DEFAULT_PROFILE = 'default';

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

export interface ConfigStore {
  activeProfile: string;
  profiles: Record<string, Profile>;
  // Global plugins (shared across all profiles)
  plugins?: CLIPluginConfig[];
  // Legacy fields for migration
  url?: string;
  insecure?: boolean;
  timeout?: number;
  defaultTenant?: string;
  credentials?: StoredCredentials;
}

export interface ProfileInfo {
  name: string;
  url: string;
  active: boolean;
  hasCredentials: boolean;
  hasApiKey: boolean;
}

export interface ApiKeyInfo {
  key: string;
  id?: string;
  name?: string;
}
