import { client } from './client.js';
import { LocalDBClient } from './db.js';
import { isLocalModeAvailable, getLocalModeStatus } from './local.js';
import { hasApiKey, getCredentials, hasEnvCredentials } from './config.js';
import type {
  HealthResponse,
  ClusterStatus,
  TenantWithUsage,
  TenantUsage,
  User,
  Superadmin,
  LockdownStatus,
  ThreatEvent,
  LockdownHistoryEntry,
  AuditEntry,
  AuditVerifyResult,
} from '../types/index.js';

/**
 * Unified interface for CLI operations.
 *
 * This module provides a unified interface that automatically chooses between:
 * - Local mode (direct database access) when running with sudo on a vault node
 * - API mode (HTTP requests) when configured with credentials
 *
 * Local mode is preferred when available as it doesn't require authentication.
 */

export type Mode = 'local' | 'api';

let _forceMode: Mode | null = null;
let _localClient: LocalDBClient | null = null;

/**
 * Force a specific mode (for testing)
 */
export function setMode(mode: Mode | null): void {
  _forceMode = mode;
}

/**
 * Determine which mode to use
 */
export function getMode(): Mode {
  if (_forceMode) {
    return _forceMode;
  }

  // Check if local mode is available (running on vault node with sudo or DATABASE_URL set)
  if (isLocalModeAvailable()) {
    return 'local';
  }

  // Fall back to API mode
  return 'api';
}

/**
 * Check if any authentication is available for API mode
 */
export function hasApiAuth(): boolean {
  return hasApiKey() || !!getCredentials() || hasEnvCredentials();
}

/**
 * Get a description of current mode for display
 */
export function getModeDescription(): string {
  const mode = getMode();

  if (mode === 'local') {
    const status = getLocalModeStatus();
    const nodeId = status.nodeId ? ` (${status.nodeId})` : '';
    return `Local mode${nodeId} - direct database access`;
  }

  if (hasApiKey()) {
    return 'API mode - using API key';
  }

  const creds = getCredentials();
  if (creds) {
    return `API mode - logged in as ${creds.username}`;
  }

  if (hasEnvCredentials()) {
    return 'API mode - using environment credentials';
  }

  return 'API mode - no authentication configured';
}

/**
 * Get the local database client (singleton)
 */
function getLocalClient(): LocalDBClient {
  _localClient ??= new LocalDBClient();
  return _localClient;
}

/**
 * Close local client connection
 */
export async function closeLocalClient(): Promise<void> {
  if (_localClient) {
    await _localClient.close();
    _localClient = null;
  }
}

// ============ Unified Operations ============

/**
 * Health check
 */
export async function health(): Promise<HealthResponse> {
  if (getMode() === 'local') {
    return getLocalClient().health();
  }
  return client.health();
}

/**
 * Leader health check (API only - local mode returns regular health)
 */
export async function leaderHealth(): Promise<HealthResponse> {
  if (getMode() === 'local') {
    // In local mode, we just return regular health
    return getLocalClient().health();
  }
  return client.leaderHealth();
}

/**
 * Cluster status
 */
export async function clusterStatus(): Promise<ClusterStatus> {
  if (getMode() === 'local') {
    return getLocalClient().clusterStatus();
  }
  return client.clusterStatus();
}

/**
 * List tenants
 */
export async function listTenants(options?: {
  status?: string;
  withUsage?: boolean;
}): Promise<TenantWithUsage[]> {
  if (getMode() === 'local') {
    return getLocalClient().listTenants(options);
  }
  return client.listTenants(options);
}

/**
 * Get tenant
 */
export async function getTenant(id: string, withUsage?: boolean): Promise<TenantWithUsage | null> {
  if (getMode() === 'local') {
    return getLocalClient().getTenant(id, withUsage);
  }
  return client.getTenant(id, withUsage);
}

/**
 * Get tenant usage
 */
export async function getTenantUsage(id: string): Promise<TenantUsage> {
  if (getMode() === 'local') {
    return getLocalClient().getTenantUsage(id);
  }
  return client.getTenantUsage(id);
}

/**
 * List users
 */
export async function listUsers(options?: {
  tenantId?: string;
  role?: string;
  status?: string;
}): Promise<User[]> {
  if (getMode() === 'local') {
    return getLocalClient().listUsers(options);
  }
  return client.listUsers(options);
}

/**
 * Get user
 */
export async function getUser(id: string): Promise<User | null> {
  if (getMode() === 'local') {
    return getLocalClient().getUser(id);
  }
  try {
    return await client.getUser(id);
  } catch {
    return null;
  }
}

/**
 * List superadmins
 */
export async function listSuperadmins(): Promise<Superadmin[]> {
  if (getMode() === 'local') {
    return getLocalClient().listSuperadmins();
  }
  return client.listSuperadmins();
}

/**
 * Get lockdown status
 */
export async function getLockdownStatus(): Promise<LockdownStatus> {
  if (getMode() === 'local') {
    return getLocalClient().getLockdownStatus();
  }
  return client.getLockdownStatus();
}

/**
 * Get lockdown history
 */
export async function getLockdownHistory(limit?: number): Promise<LockdownHistoryEntry[]> {
  if (getMode() === 'local') {
    return getLocalClient().getLockdownHistory(limit);
  }
  return client.getLockdownHistory(limit);
}

/**
 * Get threat events
 */
export async function getThreats(options?: {
  category?: string;
  since?: string;
  limit?: number;
}): Promise<ThreatEvent[]> {
  if (getMode() === 'local') {
    return getLocalClient().getThreats(options);
  }
  return client.getThreats(options);
}

/**
 * List audit entries
 */
export async function listAudit(options?: {
  user?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  if (getMode() === 'local') {
    return getLocalClient().listAudit(options);
  }
  return client.listAudit(options);
}

/**
 * Verify audit chain
 */
export async function verifyAuditChain(): Promise<AuditVerifyResult> {
  if (getMode() === 'local') {
    return getLocalClient().verifyAuditChain();
  }
  return client.verifyAuditChain();
}

/**
 * Test database connection (local mode only)
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  if (getMode() === 'local') {
    return getLocalClient().testConnection();
  }
  // In API mode, just do a health check
  try {
    await client.health();
    return { success: true, message: 'API connection successful' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get user status (local mode only returns full status)
 */
export async function getUserStatus(username: string): Promise<{
  found: boolean;
  user?: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    status: string;
    totpEnabled: boolean;
    failedAttempts: number;
    lockedUntil: string | null;
    lastLogin: string | null;
  };
}> {
  if (getMode() === 'local') {
    return getLocalClient().getUserStatus(username);
  }
  // API mode - try to get user info
  try {
    const users = await client.listUsers();
    const user = users.find(u => u.username === username || u.email === username);
    if (user) {
      return {
        found: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email ?? null,
          role: user.role,
          status: user.status,
          totpEnabled: user.totpEnabled,
          failedAttempts: user.failedAttempts,
          lockedUntil: user.lockedUntil ?? null,
          lastLogin: user.lastLogin ?? null,
        },
      };
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

/**
 * Reset user password (local mode only)
 */
export async function resetPassword(username: string, newPassword: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (getMode() !== 'local') {
    return { success: false, message: 'Password reset requires local mode (sudo on vault node)' };
  }
  return getLocalClient().resetPassword(username, newPassword);
}

/**
 * Unlock user (local mode only)
 */
export async function unlockUser(username: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (getMode() !== 'local') {
    return { success: false, message: 'Unlock requires local mode (sudo on vault node)' };
  }
  return getLocalClient().unlockUser(username);
}

/**
 * Disable TOTP (local mode only)
 */
export async function disableTotp(username: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (getMode() !== 'local') {
    return { success: false, message: 'Disable TOTP requires local mode (sudo on vault node)' };
  }
  return getLocalClient().disableTotp(username);
}

// ============ API-only operations (require authentication) ============

/**
 * Trigger lockdown (API only - requires authenticated admin action)
 */
export async function triggerLockdown(level: 1 | 2 | 3 | 4, reason: string): Promise<{
  success: boolean;
  status: string;
}> {
  if (getMode() === 'local') {
    return { success: false, status: 'Lockdown trigger requires API mode with authentication' };
  }
  return client.triggerLockdown(level, reason);
}

/**
 * Clear lockdown (API only - requires authenticated admin action)
 */
export async function clearLockdown(reason: string): Promise<{
  success: boolean;
  previousStatus: string;
}> {
  if (getMode() === 'local') {
    return { success: false, previousStatus: 'Lockdown clear requires API mode with authentication' };
  }
  return client.clearLockdown(reason);
}

/**
 * Cluster takeover (API only)
 */
export async function clusterTakeover(): Promise<{
  success: boolean;
  message: string;
  nodeId: string;
}> {
  if (getMode() === 'local') {
    return { success: false, message: 'Cluster takeover requires API mode', nodeId: '' };
  }
  return client.clusterTakeover();
}

/**
 * Cluster release (API only)
 */
export async function clusterRelease(): Promise<{ success: boolean; message: string }> {
  if (getMode() === 'local') {
    return { success: false, message: 'Cluster release requires API mode' };
  }
  return client.clusterRelease();
}

/**
 * Cluster maintenance mode (API only)
 */
export async function clusterMaintenance(enable: boolean): Promise<{
  success: boolean;
  maintenanceMode: boolean;
}> {
  if (getMode() === 'local') {
    return { success: false, maintenanceMode: false };
  }
  return client.clusterMaintenance(enable);
}

// ============ Generic API methods for certificate and other operations ============

/**
 * Generic GET request (API mode only)
 */
export async function apiGet<T = unknown>(endpoint: string): Promise<T> {
  if (getMode() === 'local') {
    throw new Error('This operation requires API mode');
  }
  return client.get<T>(endpoint);
}

/**
 * Generic POST request (API mode only)
 */
export async function apiPost<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  if (getMode() === 'local') {
    throw new Error('This operation requires API mode');
  }
  return client.post<T>(endpoint, body);
}

/**
 * Generic DELETE request (API mode only)
 */
export async function apiDelete<T = unknown>(endpoint: string): Promise<T> {
  if (getMode() === 'local') {
    throw new Error('This operation requires API mode');
  }
  return client.delete<T>(endpoint);
}

/**
 * Generic PATCH request (API mode only)
 */
export async function apiPatch<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  if (getMode() === 'local') {
    throw new Error('This operation requires API mode');
  }
  return client.patch<T>(endpoint, body);
}

/**
 * Get WebSocket URL for a given endpoint path
 */
export function getWebSocketUrl(wsPath: string): string {
  if (getMode() === 'local') {
    // In local mode, use env var or default localhost
    const localUrl = process.env.ZNVAULT_BASE_URL ?? 'https://localhost:8443';
    return localUrl.replace(/^https?:/, 'wss:') + wsPath;
  }

  // API mode - use configured vault URL
  return client.getWebSocketUrl(wsPath);
}

/**
 * Get authentication headers for WebSocket connection
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (getMode() === 'local') {
    // Local mode doesn't need auth headers for local connections
    return {};
  }

  // API mode - get auth from client
  return client.getAuthHeaders();
}
