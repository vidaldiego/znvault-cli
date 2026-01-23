// Path: src/commands/host/types.ts
// Type definitions for host management commands

/**
 * Host configuration status
 */
export type HostStatus = 'active' | 'disabled' | 'pending';

/**
 * Host configuration from vault server
 */
export interface HostConfig {
  id: string;
  tenantId: string;
  hostname: string;
  description?: string;
  config: {
    targets?: CertTarget[];
    secretTargets?: SecretTarget[];
    plugins?: PluginConfig[];
    exec?: ExecConfig;
    globalReloadCmd?: string;
    pollInterval?: number;
    verbose?: boolean;
    insecure?: boolean;
  };
  version: number;
  managedKeyName?: string;
  status: HostStatus;
  lastPulledAt?: string;
  lastPulledByAgentId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Certificate target configuration
 */
export interface CertTarget {
  certId: string;
  name: string;
  outputs: {
    combined?: string;
    cert?: string;
    key?: string;
    chain?: string;
    fullchain?: string;
  };
  owner?: string;
  mode?: string;
  reloadCmd?: string;
  healthCheckCmd?: string;
}

/**
 * Secret target configuration
 */
export interface SecretTarget {
  secretId: string;
  name: string;
  format: 'env' | 'json' | 'yaml' | 'raw' | 'template' | 'none';
  output?: string;
  key?: string;
  templatePath?: string;
  envPrefix?: string;
  owner?: string;
  mode?: string;
  reloadCmd?: string;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  package?: string;
  path?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  autoUpdate?: { enabled?: boolean; channel?: string };
}

/**
 * Exec mode configuration
 */
export interface ExecConfig {
  command: string[];
  secrets: ExecSecret[];
  inheritEnv?: boolean;
  restartOnChange?: boolean;
  restartDelayMs?: number;
  maxRestarts?: number;
  restartWindowMs?: number;
  envFile?: string;
}

/**
 * Exec secret mapping
 */
export interface ExecSecret {
  env: string;
  secret?: string;
  literal?: string;
  apiKey?: string;
  outputToFile?: boolean;
}

/**
 * Host list item (summary view, not full config)
 */
export interface HostListItem {
  id: string;
  tenantId: string;
  hostname: string;
  description?: string;
  version: number;
  managedKeyName?: string;
  status: HostStatus;
  lastPulledAt?: string;
  createdAt: string;
  updatedAt: string;
  certTargetCount: number;
  secretTargetCount: number;
  linkedAgentCount: number;
}

/**
 * Host list response
 */
export interface HostListResponse {
  items: HostListItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Host stats response
 */
export interface HostStatsResponse {
  total: number;
  active: number;
  disabled: number;
  pending: number;
}

/**
 * Host config response (for agents)
 */
export interface HostAgentConfigResponse {
  version: number;
  tenantId: string;
  config: HostConfig['config'];
  managedKeyName: string | null;
  vaultUrl: string;
}

/**
 * Bootstrap token response
 */
export interface BootstrapTokenResponse {
  token: string;
  expiresAt: string;
  bootstrapUrl: string;
  hostConfigId: string;
  hostname: string;
}

/**
 * Sync response
 */
export interface SyncResponse {
  success: boolean;
  hostname: string;
  version: number;
  linkedAgents: number;
  notifiedAgents: number;
}

/**
 * Outdated agents response
 */
export interface OutdatedAgentsResponse {
  hostname: string;
  currentVersion: number;
  agents: Array<{
    agentId: string;
    configVersion: number | null;
    versionsBehind: number;
  }>;
}

// ============================================================================
// Command Options
// ============================================================================

export interface ListOptions {
  status?: string;
  tenant?: string;
  json?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateOptions {
  managedKey?: string;
  description?: string;
  configFile?: string;
  json?: boolean;
}

export interface GetOptions {
  json?: boolean;
}

export interface ConfigOptions {
  edit?: boolean;
  import?: string;
  json?: boolean;
}

export interface DeleteOptions {
  yes?: boolean;
}

export interface BootstrapTokenOptions {
  expires?: string;
  json?: boolean;
}

export interface SyncOptions {
  force?: boolean;
  json?: boolean;
}
