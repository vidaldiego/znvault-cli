// Path: src/commands/agent/types.ts

/**
 * Type definitions for agent commands
 */

// ============================================================================
// Remote Agent Types (Vault-registered agents)
// ============================================================================

export interface RemoteAgent {
  id: string;
  tenantId: string;
  hostname: string;
  version: string | null;
  platform: string | null;
  status: 'online' | 'offline';
  lastSeen: string;
  alertOnDisconnect: boolean;
  disconnectThresholdSeconds: number;
  lastIpAddress: string | null;
  subscriptions: {
    certificates: string[];
    secrets: string[];
    updates: string | null;
  };
  apiKey: {
    name: string;
    prefix: string;
    isManaged: boolean;
    rotationMode: string | null;
    rotationIntervalSeconds: number | null;
  } | null;
}

export interface RemoteAgentConnection {
  agentId: string;
  hostname: string;
  tenantId: string;
  version: string;
  platform: string;
  connectedAt: string;
}

export interface AgentDetailResponse {
  id: string;
  tenantId: string;
  hostname: string;
  version: string | null;
  platform: string | null;
  status: 'online' | 'offline';
  connectionState: string;
  lastSeen: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  disconnectReason: string | null;
  lastHealthyAt: string | null;
  lastDegradedAt: string | null;
  degradedReason: string | null;
  alertOnDisconnect: boolean;
  disconnectThresholdSeconds: number;
  totalConnections: number;
  totalEventsReceived: number;
  lastIpAddress: string | null;
  subscriptions: {
    certificates: string[];
    secrets: string[];
    updates: string | null;
  };
  apiKey: {
    name: string;
    prefix: string;
    isManaged: boolean;
    rotationMode: string | null;
    rotationIntervalSeconds: number | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Direct Agent Communication Types (HTTP)
// ============================================================================

export interface AgentHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  plugins?: Array<{
    name: string;
    version: string;
    healthy: boolean;
  }>;
}

export interface PluginVersionInfo {
  package: string;
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export interface PluginVersionsResponse {
  hasUpdates: boolean;
  versions: PluginVersionInfo[];
  timestamp: string;
}

export interface PluginUpdateResult {
  package: string;
  previousVersion: string;
  newVersion: string;
  success: boolean;
  error?: string;
}

export interface PluginUpdateResponse {
  updated: number;
  results: PluginUpdateResult[];
  willRestart: boolean;
  message: string;
  timestamp: string;
}

export interface AgentVersionResponse {
  current: string;
  latest: string;
  updateAvailable: boolean;
  autoUpdateEnabled: boolean;
  timestamp: string;
}

export interface AgentUpdateResponse {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  willRestart: boolean;
  message: string;
  timestamp: string;
}

// ============================================================================
// Reprovision Types
// ============================================================================

export interface ReprovisionOptions {
  reason?: string;
  expiresIn?: string;
}

export interface ReprovisionResponse {
  token: string;
  agentId: string;
  tenantId: string;
  expiresAt: string;
  reason: string | null;
  newApiKeyId: string;
}

export interface ReprovisionStatusResponse {
  agentId: string;
  hostname: string;
  connectionState: string;
  hasPendingToken: boolean;
  pendingToken?: {
    id: string;
    expiresAt: string;
    createdAt: string;
    createdBy: string | null;
    reason: string | null;
  };
  lastHealthyAt: string | null;
  lastDegradedAt: string | null;
  degradedReason: string | null;
}

// ============================================================================
// Command Options Interfaces
// ============================================================================

export interface RemoteListOptions {
  status?: string;
  tenant?: string;
  json?: boolean;
}

export interface ConnectionsOptions {
  tenant?: string;
  json?: boolean;
}

export interface AlertsOptions {
  enable?: boolean;
  disable?: boolean;
  threshold?: string;
}

export interface DeleteOptions {
  yes?: boolean;
}

export interface StatusOptions {
  json?: boolean;
}

export interface TokenCreateOptions {
  managedKey?: string; // For backwards compat with -k flag
  expires: string;
  description?: string;
  tenant?: string;
  json?: boolean;
}

export interface TokenListOptions {
  managedKey?: string; // For backwards compat with -k flag
  includeUsed?: boolean;
  tenant?: string;
  json?: boolean;
}

export interface TokenRevokeOptions {
  managedKey: string;
  tenant?: string;
  yes?: boolean;
}

export interface UpdateAllOptions {
  plugins?: boolean;
  tenant?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  /** Commander sets `tunnel: false` when `--no-tunnel` is passed; default true. */
  tunnel?: boolean;
}

export interface DirectCommandOptions {
  json?: boolean;
  /** Commander sets `tunnel: false` when `--no-tunnel` is passed; default true. */
  tunnel?: boolean;
}

export interface UpdateCommandOptions {
  yes?: boolean;
  json?: boolean;
  /** Commander sets `tunnel: false` when `--no-tunnel` is passed; default true. */
  tunnel?: boolean;
}

// ============================================================================
// Registration Token Types
// ============================================================================

export interface RegistrationTokenCreateResponse {
  token: string;
  prefix: string;
  id: string;
  managedKeyName: string;
  tenantId: string;
  expiresAt: string;
  description: string | null;
}

export interface RegistrationToken {
  id: string;
  prefix: string;
  managedKeyName: string;
  tenantId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByIp: string | null;
  revokedAt: string | null;
  description: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

export interface RegistrationTokenListResponse {
  tokens: RegistrationToken[];
}

// ============================================================================
// Agent List Response Types
// ============================================================================

export interface AgentListResponse {
  agents: RemoteAgent[];
  pagination: { totalItems: number };
}

export interface ConnectionsListResponse {
  connections: RemoteAgentConnection[];
  totalConnections: number;
}
