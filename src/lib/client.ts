import https from 'node:https';
import http from 'node:http';
import {
  getConfig,
  getCredentials,
  getApiKey,
  hasApiKey,
  storeCredentials,
  isTokenExpired,
  getEnvCredentials,
  hasEnvCredentials,
} from './config.js';
import type {
  HealthResponse,
  ClusterStatus,
  Tenant,
  TenantWithUsage,
  TenantUsage,
  User,
  Superadmin,
  LockdownStatus,
  ThreatEvent,
  LockdownHistoryEntry,
  AuditEntry,
  AuditVerifyResult,
  LoginResponse,
  PaginatedResponse,
  ApiError,
  APIKey,
  CreateAPIKeyResponse,
  ListAPIKeysResponse,
  RotateAPIKeyResponse,
  APIKeySelfResponse,
  APIKeyPolicyAttachment,
  Policy,
  PolicyListResponse,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyAttachment,
  PolicyTestRequest,
  PolicyTestResult,
  ManagedAPIKey,
  ManagedKeyBindResponse,
  ManagedKeyListResponse,
  CreateManagedKeyRequest,
  CreateManagedKeyResponse,
  UpdateManagedKeyConfigRequest,
} from '../types/index.js';

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  skipAuth?: boolean;
}

interface PermissionItem {
  permission: string;
  description: string;
  category: string;
}

interface PermissionsResponse {
  permissions: PermissionItem[];
  categories: string[];
  total: number;
}

interface ValidatePermissionsResponse {
  valid: string[];
  invalid: string[];
  allValid: boolean;
}

interface ValidatePolicyResponse {
  valid: boolean;
  errors?: string[];
}

interface PolicyAttachmentsResponse {
  users: PolicyAttachment[];
  roles: PolicyAttachment[];
}

interface MessageResponse {
  message: string;
}

/**
 * Convert seconds to human-readable duration (e.g., 86400 -> "24h")
 * Prefers hours for durations up to 7 days, then uses days
 */
function formatSecondsToHuman(seconds: number): string {
  const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
  const DAY_IN_SECONDS = 24 * 60 * 60;
  const HOUR_IN_SECONDS = 60 * 60;
  const MINUTE_IN_SECONDS = 60;

  // Use days only for 7+ days and evenly divisible
  if (seconds >= WEEK_IN_SECONDS && seconds % DAY_IN_SECONDS === 0) {
    return `${seconds / DAY_IN_SECONDS}d`;
  }
  // Use hours if evenly divisible by hours
  if (seconds >= HOUR_IN_SECONDS && seconds % HOUR_IN_SECONDS === 0) {
    return `${seconds / HOUR_IN_SECONDS}h`;
  }
  // Use minutes if evenly divisible
  if (seconds >= MINUTE_IN_SECONDS && seconds % MINUTE_IN_SECONDS === 0) {
    return `${seconds / MINUTE_IN_SECONDS}m`;
  }
  return `${seconds}s`;
}

class VaultClient {
  private baseUrl: string;
  private insecure: boolean;
  private timeout: number;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.url;
    this.insecure = config.insecure;
    this.timeout = config.timeout;
  }

  /**
   * Update client configuration
   */
  configure(url?: string, insecure?: boolean): void {
    if (url) this.baseUrl = url;
    if (insecure !== undefined) this.insecure = insecure;
  }

  /**
   * Make an HTTP request
   */
  private async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl);
    url.pathname = options.path;

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Only set Content-Type for requests with a body
    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    // Add authentication
    if (!options.skipAuth) {
      const apiKey = getApiKey();
      if (hasApiKey() && apiKey) {
        headers['X-API-Key'] = apiKey;
      } else {
        const credentials = getCredentials();
        if (credentials) {
          // Check if token is expired and try to refresh
          if (isTokenExpired() && credentials.refreshToken) {
            await this.refreshToken();
          }
          const updatedCredentials = getCredentials();
          if (updatedCredentials) {
            headers.Authorization = `Bearer ${updatedCredentials.accessToken}`;
          }
        } else if (hasEnvCredentials()) {
          // Auto-login with env credentials
          const envCreds = getEnvCredentials();
          if (envCreds) {
            await this.login(envCreds.username, envCreds.password);
            const newCredentials = getCredentials();
            if (newCredentials) {
              headers.Authorization = `Bearer ${newCredentials.accessToken}`;
            }
          }
        }
      }
    }

    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers,
      timeout: this.timeout,
      rejectUnauthorized: !this.insecure,
    };

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => (data += String(chunk)));
        res.on('end', () => {
          try {
            const parsed: unknown = data ? JSON.parse(data) : {};
            if (res.statusCode && res.statusCode >= 400) {
              const error = parsed as ApiError;
              reject(new Error(error.message || `Request failed with status ${res.statusCode}`));
            } else {
              resolve(parsed as T);
            }
          } catch {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Request failed with status ${res.statusCode}`));
            } else {
              resolve(data as unknown as T);
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body !== undefined && options.body !== null) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // ============ Authentication ============

  async login(username: string, password: string, totp?: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>({
      method: 'POST',
      path: '/auth/login',
      body: { username, password, totp },
      skipAuth: true,
    });

    // Store credentials
    storeCredentials({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      userId: response.user.id,
      username: response.user.username,
      role: response.user.role,
      tenantId: response.user.tenantId,
    });

    return response;
  }

  async refreshToken(): Promise<void> {
    const credentials = getCredentials();
    if (!credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.request<LoginResponse>({
      method: 'POST',
      path: '/auth/refresh',
      body: { refreshToken: credentials.refreshToken },
      skipAuth: true,
    });

    storeCredentials({
      ...credentials,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
    });
  }

  // ============ Health ============

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: 'GET',
      path: '/v1/health',
      skipAuth: true,
    });
  }

  async leaderHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: 'GET',
      path: '/v1/health/leader',
      skipAuth: true,
    });
  }

  // ============ Cluster ============

  async clusterStatus(): Promise<ClusterStatus> {
    return this.request<ClusterStatus>({
      method: 'GET',
      path: '/v1/admin/cluster',
    });
  }

  async clusterTakeover(): Promise<{ success: boolean; message: string; nodeId: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/takeover',
    });
  }

  async clusterPromote(nodeId: string): Promise<{ success: boolean; message: string }> {
    return this.request({
      method: 'POST',
      path: `/v1/admin/cluster/nodes/${nodeId}/promote`,
    });
  }

  async clusterRelease(): Promise<{ success: boolean; message: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/release',
    });
  }

  async clusterMaintenance(enable: boolean): Promise<{ success: boolean; maintenanceMode: boolean }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/maintenance',
      body: { enable },
    });
  }

  // ============ Tenants ============

  async listTenants(options?: {
    status?: string;
    withUsage?: boolean;
  }): Promise<TenantWithUsage[]> {
    const response = await this.request<PaginatedResponse<TenantWithUsage>>({
      method: 'GET',
      path: '/v1/tenants',
      query: {
        status: options?.status,
        withUsage: options?.withUsage,
        pageSize: 1000,
      },
    });
    return response.data;
  }

  async createTenant(data: {
    id: string;
    name: string;
    maxSecrets?: number;
    maxKmsKeys?: number;
    contactEmail?: string;
  }): Promise<Tenant> {
    return this.request<Tenant>({
      method: 'POST',
      path: '/v1/tenants',
      body: data,
    });
  }

  async getTenant(id: string, withUsage?: boolean): Promise<TenantWithUsage> {
    const response = await this.request<{ data: TenantWithUsage }>({
      method: 'GET',
      path: `/v1/tenants/${id}`,
      query: { withUsage },
    });
    return response.data;
  }

  async updateTenant(id: string, data: {
    name?: string;
    maxSecrets?: number;
    maxKmsKeys?: number;
    contactEmail?: string;
    status?: 'active' | 'suspended';
  }): Promise<Tenant> {
    return this.request<Tenant>({
      method: 'PATCH',
      path: `/v1/tenants/${id}`,
      body: data,
    });
  }

  async deleteTenant(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/tenants/${id}`,
    });
  }

  async getTenantUsage(id: string): Promise<TenantUsage> {
    const response = await this.request<{ data: TenantUsage }>({
      method: 'GET',
      path: `/v1/tenants/${id}/usage`,
    });
    return response.data;
  }

  // ============ Users ============

  async listUsers(options?: {
    tenantId?: string;
    role?: string;
    status?: string;
  }): Promise<User[]> {
    const response = await this.request<PaginatedResponse<User>>({
      method: 'GET',
      path: '/v1/users',
      query: {
        tenantId: options?.tenantId,
        role: options?.role,
        status: options?.status,
        pageSize: 1000,
      },
    });
    return response.data;
  }

  async createUser(data: {
    username: string;
    password: string;
    email?: string;
    tenantId?: string;
    role?: 'user' | 'admin';
  }): Promise<User> {
    return this.request<User>({
      method: 'POST',
      path: '/v1/users',
      body: data,
    });
  }

  async getUser(id: string): Promise<User> {
    return this.request<User>({
      method: 'GET',
      path: `/v1/users/${id}`,
    });
  }

  async updateUser(id: string, data: {
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'disabled';
  }): Promise<User> {
    return this.request<User>({
      method: 'PUT',
      path: `/v1/users/${id}`,
      body: data,
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/users/${id}`,
    });
  }

  async unlockUser(id: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'PUT',
      path: `/v1/users/${id}`,
      body: { status: 'active', failedAttempts: 0, lockedUntil: null },
    });
  }

  async resetUserPassword(id: string, newPassword: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/users/${id}/reset-password`,
      body: { newPassword },
    });
  }

  async disableUserTotp(id: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/users/${id}/totp/disable`,
    });
  }

  // ============ Superadmins ============

  async listSuperadmins(): Promise<Superadmin[]> {
    const users = await this.listUsers({ role: 'superadmin' });
    return users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      status: u.status,
      totpEnabled: u.totpEnabled,
      failedAttempts: u.failedAttempts,
      lockedUntil: u.lockedUntil,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    }));
  }

  async createSuperadmin(data: {
    username: string;
    password: string;
    email?: string;
  }): Promise<Superadmin> {
    return this.request<Superadmin>({
      method: 'POST',
      path: '/v1/superadmins',
      body: data,
    });
  }

  async resetSuperadminPassword(username: string, password: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/password`,
      body: { password },
    });
  }

  async unlockSuperadmin(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/unlock`,
    });
  }

  async disableSuperadmin(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/disable`,
    });
  }

  async enableSuperadmin(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/enable`,
    });
  }

  // ============ Lockdown ============

  async getLockdownStatus(): Promise<LockdownStatus> {
    return this.request<LockdownStatus>({
      method: 'GET',
      path: '/v1/admin/lockdown/status',
    });
  }

  async triggerLockdown(level: 1 | 2 | 3 | 4, reason: string): Promise<{ success: boolean; status: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/lockdown/trigger',
      body: { level, reason },
    });
  }

  async clearLockdown(reason: string): Promise<{ success: boolean; previousStatus: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/lockdown/clear',
      body: { reason },
    });
  }

  async getLockdownHistory(limit?: number): Promise<LockdownHistoryEntry[]> {
    const response = await this.request<PaginatedResponse<LockdownHistoryEntry>>({
      method: 'GET',
      path: '/v1/admin/lockdown/history',
      query: { limit: limit ?? 50 },
    });
    return response.data;
  }

  async getThreats(options?: {
    category?: string;
    since?: string;
    limit?: number;
  }): Promise<ThreatEvent[]> {
    const response = await this.request<PaginatedResponse<ThreatEvent>>({
      method: 'GET',
      path: '/v1/admin/lockdown/threats',
      query: {
        category: options?.category,
        since: options?.since,
        limit: options?.limit ?? 100,
      },
    });
    return response.data;
  }

  // ============ Audit ============

  async listAudit(options?: {
    user?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const response = await this.request<PaginatedResponse<AuditEntry>>({
      method: 'GET',
      path: '/v1/audit',
      query: {
        client_cn: options?.user,
        action: options?.action,
        start_date: options?.startDate,
        end_date: options?.endDate,
        limit: options?.limit ?? 100,
      },
    });
    return response.data;
  }

  async verifyAuditChain(): Promise<AuditVerifyResult> {
    return this.request<AuditVerifyResult>({
      method: 'GET',
      path: '/v1/audit/verify',
    });
  }

  async exportAudit(options?: {
    format?: 'json' | 'csv';
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    return this.request<string>({
      method: 'GET',
      path: '/v1/audit',
      query: {
        format: options?.format ?? 'json',
        start_date: options?.startDate,
        end_date: options?.endDate,
        limit: 10000,
      },
    });
  }

  // ============ API Keys (Independent, tenant-scoped) ============

  async createApiKey(data: {
    name: string;
    description?: string;
    expiresInDays?: number;
    permissions: string[];
    tenantId?: string;
    ipAllowlist?: string[];
    conditions?: Record<string, unknown>;
  }): Promise<CreateAPIKeyResponse> {
    return this.request<CreateAPIKeyResponse>({
      method: 'POST',
      path: '/auth/api-keys',
      query: data.tenantId ? { tenantId: data.tenantId } : undefined,
      body: {
        name: data.name,
        description: data.description,
        expiresInDays: data.expiresInDays,
        permissions: data.permissions,
        ipAllowlist: data.ipAllowlist,
        conditions: data.conditions,
      },
    });
  }

  async listApiKeys(tenantId?: string): Promise<ListAPIKeysResponse> {
    return this.request<ListAPIKeysResponse>({
      method: 'GET',
      path: '/auth/api-keys',
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getApiKey(id: string, tenantId?: string): Promise<APIKey> {
    return this.request<APIKey>({
      method: 'GET',
      path: `/auth/api-keys/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async deleteApiKey(id: string, tenantId?: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/auth/api-keys/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async rotateApiKey(id: string, name?: string, tenantId?: string): Promise<RotateAPIKeyResponse> {
    return this.request<RotateAPIKeyResponse>({
      method: 'POST',
      path: `/auth/api-keys/${id}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: name ? { name } : {},
    });
  }

  async updateApiKeyPermissions(id: string, permissions: string[], tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/permissions`,
      query: tenantId ? { tenantId } : undefined,
      body: { permissions },
    });
    return response.apiKey;
  }

  async updateApiKeyConditions(id: string, conditions: Record<string, unknown>, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/conditions`,
      query: tenantId ? { tenantId } : undefined,
      body: { conditions },
    });
    return response.apiKey;
  }

  async setApiKeyEnabled(id: string, enabled: boolean, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/enabled`,
      query: tenantId ? { tenantId } : undefined,
      body: { enabled },
    });
    return response.apiKey;
  }

  // =========================================================================
  // Permissions API
  // =========================================================================

  /**
   * Get all available permissions from the database
   * This is the single source of truth for valid permission IDs
   */
  async getPermissions(category?: string): Promise<PermissionsResponse> {
    return this.request<PermissionsResponse>({
      method: 'GET',
      path: '/v1/permissions',
      query: category ? { category } : undefined,
    });
  }

  /**
   * Validate a list of permission IDs against the database
   */
  async validatePermissions(permissions: string[]): Promise<ValidatePermissionsResponse> {
    return this.request<ValidatePermissionsResponse>({
      method: 'POST',
      path: '/v1/permissions/validate',
      body: { permissions },
    });
  }

  async getApiKeyPolicies(id: string, tenantId?: string): Promise<{ policies: APIKeyPolicyAttachment[] }> {
    return this.request<{ policies: APIKeyPolicyAttachment[] }>({
      method: 'GET',
      path: `/auth/api-keys/${id}/policies`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async attachApiKeyPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/auth/api-keys/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async detachApiKeyPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `/auth/api-keys/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getApiKeySelf(): Promise<APIKeySelfResponse> {
    return this.request<APIKeySelfResponse>({
      method: 'GET',
      path: '/auth/api-keys/self',
    });
  }

  async rotateApiKeySelf(name?: string): Promise<RotateAPIKeyResponse & { expiresInDays: number }> {
    return this.request<RotateAPIKeyResponse & { expiresInDays: number }>({
      method: 'POST',
      path: '/auth/api-keys/self/rotate',
      body: name ? { name } : {},
    });
  }

  // ============ Managed API Keys ============

  async createManagedApiKey(data: CreateManagedKeyRequest): Promise<CreateManagedKeyResponse> {
    // Server returns apiKey with _seconds fields that need conversion
    interface ServerCreateResponse {
      apiKey: {
        id: string;
        name: string;
        description: string | null;
        prefix: string;
        expires_at: string;
        created_at: string;
        tenant_id: string;
        created_by: string;
        permissions: string[];
        conditions: Record<string, unknown>;
        enabled: boolean;
        rotation_count: number;
        last_rotation: string | null;
        is_managed: boolean;
        rotation_mode: string;
        rotation_interval_seconds?: number;
        grace_period_seconds: number;
        next_rotation_at: string;
        notify_before?: string;
        webhook_url?: string;
        last_bound_at?: string;
      };
      message: string;
    }

    const response = await this.request<ServerCreateResponse>({
      method: 'POST',
      path: '/auth/api-keys',
      query: data.tenantId ? { tenantId: data.tenantId } : undefined,
      body: {
        name: data.name,
        description: data.description,
        expiresInDays: data.expiresInDays,
        permissions: data.permissions,
        ipAllowlist: data.ipAllowlist,
        conditions: data.conditions,
        managed: data.managed,
      },
    });

    // Transform server response to CLI format
    const serverKey = response.apiKey;
    return {
      apiKey: {
        id: serverKey.id,
        tenant_id: serverKey.tenant_id,
        created_by: serverKey.created_by,
        name: serverKey.name,
        description: serverKey.description,
        prefix: serverKey.prefix,
        expires_at: serverKey.expires_at,
        last_used: null,
        created_at: serverKey.created_at,
        ip_allowlist: null,
        permissions: serverKey.permissions,
        conditions: serverKey.conditions,
        created_by_username: undefined,
        enabled: serverKey.enabled,
        rotation_count: serverKey.rotation_count,
        last_rotation: serverKey.last_rotation,
        is_managed: serverKey.is_managed,
        rotation_mode: serverKey.rotation_mode as 'scheduled' | 'on-use' | 'on-bind',
        rotation_interval: serverKey.rotation_interval_seconds ? formatSecondsToHuman(serverKey.rotation_interval_seconds) : undefined,
        grace_period: formatSecondsToHuman(serverKey.grace_period_seconds),
        notify_before: serverKey.notify_before,
        webhook_url: serverKey.webhook_url,
        next_rotation_at: serverKey.next_rotation_at,
        last_bound_at: serverKey.last_bound_at,
      },
      message: response.message,
    };
  }

  async listManagedApiKeys(tenantId?: string): Promise<ManagedKeyListResponse> {
    // Server returns keys with _seconds fields
    interface ServerListKey {
      id: string;
      tenant_id: string;
      created_by: string;
      created_by_username?: string;
      name: string;
      description: string | null;
      prefix: string;
      expires_at: string;
      last_used: string | null;
      created_at: string;
      permissions: string[];
      conditions: Record<string, unknown>;
      enabled: boolean;
      rotation_count: number;
      last_rotation: string | null;
      is_managed: boolean;
      rotation_mode: string;
      rotation_interval_seconds?: number;
      grace_period_seconds: number;
      first_used_at?: string | null;
      grace_expires_at?: string | null;
      next_rotation_at?: string;
      rotation_webhook_url?: string | null;
      notify_before?: string;
    }

    interface ServerListResponse {
      keys: ServerListKey[];
      total?: number;
    }

    const response = await this.request<ServerListResponse>({
      method: 'GET',
      path: '/auth/api-keys/managed',
      query: tenantId ? { tenantId } : undefined,
    });

    // Transform each key
    return {
      keys: response.keys.map(key => ({
        id: key.id,
        tenant_id: key.tenant_id,
        created_by: key.created_by,
        name: key.name,
        description: key.description,
        prefix: key.prefix,
        expires_at: key.expires_at,
        last_used: key.last_used,
        created_at: key.created_at,
        ip_allowlist: null,
        permissions: key.permissions,
        conditions: key.conditions,
        created_by_username: key.created_by_username,
        enabled: key.enabled,
        rotation_count: key.rotation_count,
        last_rotation: key.last_rotation,
        is_managed: key.is_managed,
        rotation_mode: key.rotation_mode as 'scheduled' | 'on-use' | 'on-bind',
        rotation_interval: key.rotation_interval_seconds ? formatSecondsToHuman(key.rotation_interval_seconds) : undefined,
        grace_period: formatSecondsToHuman(key.grace_period_seconds),
        notify_before: key.notify_before,
        webhook_url: key.rotation_webhook_url ?? undefined,
        next_rotation_at: key.next_rotation_at,
        last_bound_at: key.first_used_at ?? undefined,
      })),
      total: response.total ?? response.keys.length,
    };
  }

  async getManagedApiKey(name: string, tenantId?: string): Promise<ManagedAPIKey> {
    // Server returns ManagedKeyInfo in camelCase, transform to CLI's snake_case format
    interface ServerManagedKeyInfo {
      id: string;
      name: string;
      prefix: string;
      tenantId: string;
      isManaged: boolean;
      rotationMode: string;
      rotationIntervalSeconds?: number;
      gracePeriodSeconds: number;
      nextRotationAt?: string;
      graceExpiresAt?: string;
      firstUsedAt?: string;
      lastRotatedAt?: string;
      rotationCount: number;
      hasNextKey: boolean;
      enabled: boolean;
      permissions: string[];
      webhookUrl?: string;
      description?: string;
      expiresAt?: string;
      createdAt?: string;
      createdBy?: string;
      createdByUsername?: string;
      lastUsed?: string;
      lastBoundAt?: string;
      notifyBefore?: string;
    }

    const info = await this.request<ServerManagedKeyInfo>({
      method: 'GET',
      path: `/auth/api-keys/managed/${encodeURIComponent(name)}`,
      query: tenantId ? { tenantId } : undefined,
    });

    // Transform to CLI's ManagedAPIKey format (snake_case)
    return {
      id: info.id,
      tenant_id: info.tenantId,
      created_by: info.createdBy ?? null,
      name: info.name,
      description: info.description ?? null,
      prefix: info.prefix,
      expires_at: info.expiresAt ?? '',
      last_used: info.lastUsed ?? null,
      created_at: info.createdAt ?? '',
      ip_allowlist: null, // Not returned by server
      permissions: info.permissions,
      conditions: undefined,
      created_by_username: info.createdByUsername,
      enabled: info.enabled,
      rotation_count: info.rotationCount,
      last_rotation: info.lastRotatedAt ?? null,
      is_managed: info.isManaged,
      rotation_mode: info.rotationMode as 'scheduled' | 'on-use' | 'on-bind',
      rotation_interval: info.rotationIntervalSeconds ? formatSecondsToHuman(info.rotationIntervalSeconds) : undefined,
      grace_period: formatSecondsToHuman(info.gracePeriodSeconds),
      notify_before: info.notifyBefore,
      webhook_url: info.webhookUrl,
      next_rotation_at: info.nextRotationAt,
      last_bound_at: info.lastBoundAt,
    };
  }

  async bindManagedApiKey(name: string, tenantId?: string): Promise<ManagedKeyBindResponse> {
    return this.request<ManagedKeyBindResponse>({
      method: 'POST',
      path: `/auth/api-keys/managed/${encodeURIComponent(name)}/bind`,
      query: tenantId ? { tenantId } : undefined,
      body: {},
    });
  }

  async rotateManagedApiKey(name: string, tenantId?: string): Promise<{ message: string; nextRotationAt?: string }> {
    return this.request<{ message: string; nextRotationAt?: string }>({
      method: 'POST',
      path: `/auth/api-keys/managed/${encodeURIComponent(name)}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: {},
    });
  }

  async updateManagedApiKeyConfig(
    name: string,
    config: UpdateManagedKeyConfigRequest,
    tenantId?: string
  ): Promise<ManagedAPIKey> {
    // Server returns ManagedKeyInfo directly in camelCase
    interface ServerManagedKeyInfo {
      id: string;
      name: string;
      prefix: string;
      tenantId: string;
      isManaged: boolean;
      rotationMode: string;
      rotationIntervalSeconds?: number;
      gracePeriodSeconds: number;
      nextRotationAt?: string;
      graceExpiresAt?: string;
      lastRotatedAt?: string;
      rotationCount: number;
      hasNextKey: boolean;
      enabled: boolean;
      permissions: string[];
      webhookUrl?: string;
      description?: string;
      expiresAt?: string;
      createdAt?: string;
      createdBy?: string;
      createdByUsername?: string;
      lastUsed?: string;
      lastBoundAt?: string;
      notifyBefore?: string;
    }

    const info = await this.request<ServerManagedKeyInfo>({
      method: 'PATCH',
      path: `/auth/api-keys/managed/${encodeURIComponent(name)}/config`,
      query: tenantId ? { tenantId } : undefined,
      body: config,
    });

    // Transform to CLI's ManagedAPIKey format (snake_case)
    return {
      id: info.id,
      tenant_id: info.tenantId,
      created_by: info.createdBy ?? null,
      name: info.name,
      description: info.description ?? null,
      prefix: info.prefix,
      expires_at: info.expiresAt ?? '',
      last_used: info.lastUsed ?? null,
      created_at: info.createdAt ?? '',
      ip_allowlist: null,
      permissions: info.permissions,
      conditions: undefined,
      created_by_username: info.createdByUsername,
      enabled: info.enabled,
      rotation_count: info.rotationCount,
      last_rotation: info.lastRotatedAt ?? null,
      is_managed: info.isManaged,
      rotation_mode: info.rotationMode as 'scheduled' | 'on-use' | 'on-bind',
      rotation_interval: info.rotationIntervalSeconds ? formatSecondsToHuman(info.rotationIntervalSeconds) : undefined,
      grace_period: formatSecondsToHuman(info.gracePeriodSeconds),
      notify_before: info.notifyBefore,
      webhook_url: info.webhookUrl,
      next_rotation_at: info.nextRotationAt,
      last_bound_at: info.lastBoundAt,
    };
  }

  async deleteManagedApiKey(name: string, tenantId?: string): Promise<void> {
    // First get the managed key to find its ID
    const key = await this.getManagedApiKey(name, tenantId);
    // Then delete via the standard API key delete endpoint
    await this.request<unknown>({
      method: 'DELETE',
      path: `/auth/api-keys/${encodeURIComponent(key.id)}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  // ============ ABAC Policies ============

  async listPolicies(options?: {
    tenantId?: string;
    enabled?: boolean;
    effect?: 'allow' | 'deny';
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PolicyListResponse> {
    return this.request<PolicyListResponse>({
      method: 'GET',
      path: '/v1/policies',
      query: {
        tenantId: options?.tenantId,
        enabled: options?.enabled,
        effect: options?.effect,
        search: options?.search,
        page: options?.page,
        pageSize: options?.pageSize ?? 100,
      },
    });
  }

  async getPolicy(id: string): Promise<Policy> {
    return this.request<Policy>({
      method: 'GET',
      path: `/v1/policies/${id}`,
    });
  }

  async createPolicy(data: CreatePolicyInput): Promise<Policy> {
    return this.request<Policy>({
      method: 'POST',
      path: '/v1/policies',
      body: data,
    });
  }

  async updatePolicy(id: string, data: UpdatePolicyInput): Promise<Policy> {
    return this.request<Policy>({
      method: 'PATCH',
      path: `/v1/policies/${id}`,
      body: data,
    });
  }

  async deletePolicy(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/policies/${id}`,
    });
  }

  async togglePolicy(id: string, enabled: boolean): Promise<Policy> {
    return this.request<Policy>({
      method: 'POST',
      path: `/v1/policies/${id}/toggle`,
      body: { enabled },
    });
  }

  async validatePolicy(policy: CreatePolicyInput): Promise<ValidatePolicyResponse> {
    return this.request<ValidatePolicyResponse>({
      method: 'POST',
      path: '/v1/policies/validate',
      body: policy,
    });
  }

  async getPolicyAttachments(policyId: string): Promise<PolicyAttachmentsResponse> {
    return this.request<PolicyAttachmentsResponse>({
      method: 'GET',
      path: `/v1/policies/${policyId}/attachments`,
    });
  }

  async attachPolicyToUser(policyId: string, userId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/policies/${policyId}/attach/user`,
      body: { userId },
    });
  }

  async attachPolicyToRole(policyId: string, roleId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/policies/${policyId}/attach/role`,
      body: { roleId },
    });
  }

  async detachPolicyFromUser(policyId: string, userId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `/v1/policies/${policyId}/attach/user/${userId}`,
    });
  }

  async detachPolicyFromRole(policyId: string, roleId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `/v1/policies/${policyId}/attach/role/${roleId}`,
    });
  }

  async getUserPolicies(userId: string): Promise<Policy[]> {
    const response = await this.request<{ policies: Policy[] }>({
      method: 'GET',
      path: `/v1/users/${userId}/policies`,
    });
    return response.policies;
  }

  async getRolePolicies(roleId: string): Promise<Policy[]> {
    const response = await this.request<{ policies: Policy[] }>({
      method: 'GET',
      path: `/v1/roles/${roleId}/policies`,
    });
    return response.policies;
  }

  async testPolicy(request: PolicyTestRequest): Promise<PolicyTestResult> {
    return this.request<PolicyTestResult>({
      method: 'POST',
      path: '/v1/policies/test',
      body: request,
    });
  }

  // ============ Generic methods for arbitrary endpoints ============

  /**
   * Generic GET request
   * @param path - Path may include query string (e.g., '/v1/secrets?tenant=foo')
   */
  async get<T>(path: string): Promise<T> {
    // Handle paths that include query strings
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({ method: 'GET', path: basePath, query: Object.keys(query).length > 0 ? query : undefined });
  }

  /**
   * Generic POST request
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  /**
   * Generic DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', path });
  }

  /**
   * Generic PUT request
   */
  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'PUT', path, body });
  }

  /**
   * Generic PATCH request
   */
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  /**
   * Get WebSocket URL for a given endpoint path
   */
  getWebSocketUrl(wsPath: string): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = wsPath;
    return url.toString();
  }

  /**
   * Get authentication headers for WebSocket connection
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    const apiKey = getApiKey();
    if (hasApiKey() && apiKey) {
      headers['X-API-Key'] = apiKey;
    } else {
      const credentials = getCredentials();
      if (credentials) {
        // Check if token is expired and try to refresh
        if (isTokenExpired() && credentials.refreshToken) {
          await this.refreshToken();
        }
        const updatedCredentials = getCredentials();
        if (updatedCredentials) {
          headers.Authorization = `Bearer ${updatedCredentials.accessToken}`;
        }
      } else if (hasEnvCredentials()) {
        // Auto-login with env credentials
        const envCreds = getEnvCredentials();
        if (envCreds) {
          await this.login(envCreds.username, envCreds.password);
          const newCredentials = getCredentials();
          if (newCredentials) {
            headers.Authorization = `Bearer ${newCredentials.accessToken}`;
          }
        }
      }
    }

    return headers;
  }
}

// Export singleton instance
export const client = new VaultClient();

// Export class for testing
export { VaultClient };
