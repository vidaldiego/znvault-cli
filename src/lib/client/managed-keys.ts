// Path: src/lib/client/managed-keys.ts

/**
 * Managed API Key client
 *
 * Routing policy:
 *   - When `tenantId` is supplied, target `/v1/superadmin/api-keys/*`
 *     (cross-tenant superadmin surface).
 *   - When `tenantId` is omitted, target `/auth/api-keys/*` (tenant
 *     principal, tenant derived from JWT).
 */

import { HttpClient } from './http.js';
import { formatSecondsToHuman } from '../format-helpers.js';

const TENANT_BASE = '/auth/api-keys';
const ADMIN_BASE = '/v1/superadmin/api-keys';

function basePath(tenantId?: string, asSuperadmin?: boolean): string {
  return tenantId || asSuperadmin ? ADMIN_BASE : TENANT_BASE;
}

export interface ManagedKeyScope {
  asSuperadmin?: boolean;
}
import type {
  ManagedAPIKey,
  ManagedKeyBindResponse,
  ManagedKeyListResponse,
  CreateManagedKeyRequest,
  CreateManagedKeyResponse,
  UpdateManagedKeyConfigRequest,
} from '../../types/index.js';

// Server response types (for transformation)
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

export class ManagedKeysClient extends HttpClient {
  async create(data: CreateManagedKeyRequest & ManagedKeyScope): Promise<CreateManagedKeyResponse> {
    const response = await this.request<ServerCreateResponse>({
      method: 'POST',
      path: basePath(data.tenantId, data.asSuperadmin),
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
        rotation_interval: serverKey.rotation_interval_seconds
          ? formatSecondsToHuman(serverKey.rotation_interval_seconds)
          : undefined,
        grace_period: formatSecondsToHuman(serverKey.grace_period_seconds),
        notify_before: serverKey.notify_before,
        webhook_url: serverKey.webhook_url,
        next_rotation_at: serverKey.next_rotation_at,
        last_bound_at: serverKey.last_bound_at,
      },
      message: response.message,
    };
  }

  async list(tenantId?: string, opts?: ManagedKeyScope): Promise<ManagedKeyListResponse> {
    interface ServerListResponse {
      items: ServerListKey[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    }

    const response = await this.request<ServerListResponse>({
      method: 'GET',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/managed`,
      query: tenantId ? { tenantId } : undefined,
    });

    return {
      items: response.items.map(key => ({
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
        rotation_interval: key.rotation_interval_seconds
          ? formatSecondsToHuman(key.rotation_interval_seconds)
          : undefined,
        grace_period: formatSecondsToHuman(key.grace_period_seconds),
        notify_before: key.notify_before,
        webhook_url: key.rotation_webhook_url ?? undefined,
        next_rotation_at: key.next_rotation_at,
        last_bound_at: key.first_used_at ?? undefined,
      })),
      pagination: response.pagination,
    };
  }

  async getByName(name: string, tenantId?: string, opts?: ManagedKeyScope): Promise<ManagedAPIKey> {
    const info = await this.request<ServerManagedKeyInfo>({
      method: 'GET',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/managed/${encodeURIComponent(name)}`,
      query: tenantId ? { tenantId } : undefined,
    });

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
      rotation_interval: info.rotationIntervalSeconds
        ? formatSecondsToHuman(info.rotationIntervalSeconds)
        : undefined,
      grace_period: formatSecondsToHuman(info.gracePeriodSeconds),
      notify_before: info.notifyBefore,
      webhook_url: info.webhookUrl,
      next_rotation_at: info.nextRotationAt,
      last_bound_at: info.lastBoundAt,
    };
  }

  async bind(name: string, tenantId?: string, opts?: ManagedKeyScope): Promise<ManagedKeyBindResponse> {
    return this.request<ManagedKeyBindResponse>({
      method: 'POST',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/managed/${encodeURIComponent(name)}/bind`,
      query: tenantId ? { tenantId } : undefined,
      body: {},
    });
  }

  async rotate(name: string, tenantId?: string, opts?: ManagedKeyScope): Promise<{ message: string; nextRotationAt?: string }> {
    return this.request<{ message: string; nextRotationAt?: string }>({
      method: 'POST',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/managed/${encodeURIComponent(name)}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: {},
    });
  }

  async updateConfig(
    name: string,
    config: UpdateManagedKeyConfigRequest,
    tenantId?: string,
    opts?: ManagedKeyScope
  ): Promise<ManagedAPIKey> {
    const info = await this.request<ServerManagedKeyInfo>({
      method: 'PATCH',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/managed/${encodeURIComponent(name)}/config`,
      query: tenantId ? { tenantId } : undefined,
      body: config,
    });

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
      rotation_interval: info.rotationIntervalSeconds
        ? formatSecondsToHuman(info.rotationIntervalSeconds)
        : undefined,
      grace_period: formatSecondsToHuman(info.gracePeriodSeconds),
      notify_before: info.notifyBefore,
      webhook_url: info.webhookUrl,
      next_rotation_at: info.nextRotationAt,
      last_bound_at: info.lastBoundAt,
    };
  }

  async deleteByName(name: string, tenantId?: string, opts?: ManagedKeyScope): Promise<void> {
    // Both admin and tenant routes require an id-based DELETE; the tenant
    // surface does not expose DELETE by name. Always resolve to id first.
    const key = await this.getByName(name, tenantId, opts);
    await this.request<unknown>({
      method: 'DELETE',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${encodeURIComponent(key.id)}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }
}
