// Path: src/lib/config/types.ts

/**
 * Config module types
 */

import type { StoredCredentials } from '../../types/index.js';
import type { CLIPluginConfig } from '../../plugins/types.js';
import { DEFAULT_VAULT_URL, DEFAULT_TIMEOUT_MS } from '../constants.js';

export const CONFIG_DEFAULTS = {
  url: DEFAULT_VAULT_URL,
  insecure: false,
  timeout: DEFAULT_TIMEOUT_MS,
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
  autoUnsealSecret?: string;  // TOTP secret for auto-unseal (dev convenience)
  // SSH configuration
  sshUser?: string;  // Default SSH username for `znvault ssh connect`
  sshIdentity?: string;  // Default SSH identity file path
  sshBookmarks?: Record<string, SSHBookmark>;  // Named host bookmarks
  // MySQL alias store: maps alias name → connection+role
  mysqlAliases?: Record<string, { connection: string; role: string }>;
}

export interface SSHBookmark {
  host: string;
  port?: number;
  user?: string;
  identity?: string;
  principals?: string[];
  description?: string;
  createdAt: string;
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
