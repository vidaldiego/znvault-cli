// Path: src/lib/client/quarantine.ts

/**
 * IP Quarantine management client
 *
 * Routing:
 *   - `asSuperadmin: true` → `/v1/superadmin/quarantine/*` (cross-tenant;
 *     used under `znvault superadmin quarantine`). Optional `tenantId`
 *     filters to a specific tenant; omitting it targets the system
 *     (null-tenant) scope.
 *   - otherwise → `/v1/quarantine/*` (tenant-scoped; tenant derived from
 *     the JWT).
 *
 * Pre-v4.0.1 the routing used `tenantId` truthiness as the discriminator;
 * that broke `znvault superadmin quarantine list` (no `--tenant`) because
 * the request fell through to `/v1/quarantine`, which the server rejects
 * for superadmin principals with "Superadmins must use /v1/superadmin/*
 * routes".
 */

import { HttpClient } from './http.js';
import type {
  IpQuarantine,
  IpQuarantineStats,
  IpQuarantineConfig,
  IpFailureHistory,
  PaginatedResponse,
} from '../../types/index.js';

export interface ListQuarantineOptions {
  status?: 'active' | 'released' | 'expired';
  tenantId?: string;
  includeExpired?: boolean;
  limit?: number;
  offset?: number;
  asSuperadmin?: boolean;
}

export interface ReleaseResult {
  success: boolean;
  message: string;
  releasedCount?: number;
}

export interface QuarantineScope {
  asSuperadmin?: boolean;
  tenantId?: string;
}

function basePath(asSuperadmin?: boolean): string {
  return asSuperadmin ? '/v1/superadmin/quarantine' : '/v1/quarantine';
}

function tenantQuery(scope?: QuarantineScope): { tenantId?: string } | undefined {
  if (!scope?.asSuperadmin) return undefined;
  return scope.tenantId !== undefined && scope.tenantId !== ''
    ? { tenantId: scope.tenantId }
    : undefined;
}

export class QuarantineClient extends HttpClient {
  async list(options?: ListQuarantineOptions): Promise<PaginatedResponse<IpQuarantine>> {
    return this.request<PaginatedResponse<IpQuarantine>>({
      method: 'GET',
      path: basePath(options?.asSuperadmin),
      query: {
        status: options?.status,
        tenantId: options?.asSuperadmin ? options.tenantId : undefined,
        includeExpired: options?.includeExpired,
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
      },
    });
  }

  async getById(id: string, scope?: QuarantineScope): Promise<IpQuarantine> {
    return this.request<IpQuarantine>({
      method: 'GET',
      path: `${basePath(scope?.asSuperadmin)}/${id}`,
      query: tenantQuery(scope),
    });
  }

  async release(id: string, reason: string, scope?: QuarantineScope): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `${basePath(scope?.asSuperadmin)}/${id}/release`,
      query: tenantQuery(scope),
      body: { reason },
    });
  }

  async releaseIp(ip: string, reason: string, scope?: QuarantineScope): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `${basePath(scope?.asSuperadmin)}/ip/${encodeURIComponent(ip)}/release`,
      query: tenantQuery(scope),
      body: { reason },
    });
  }

  async getHistory(
    ip: string,
    options?: { limit?: number; tenantId?: string; asSuperadmin?: boolean }
  ): Promise<{ ip: string; failures: IpFailureHistory[] }> {
    return this.request({
      method: 'GET',
      path: `${basePath(options?.asSuperadmin)}/ip/${encodeURIComponent(ip)}/history`,
      query: {
        limit: options?.limit ?? 100,
        tenantId: options?.asSuperadmin ? options.tenantId : undefined,
      },
    });
  }

  async getStats(scope?: QuarantineScope): Promise<IpQuarantineStats> {
    return this.request<IpQuarantineStats>({
      method: 'GET',
      path: `${basePath(scope?.asSuperadmin)}/stats`,
      query: tenantQuery(scope),
    });
  }

  async getConfig(scope?: QuarantineScope): Promise<IpQuarantineConfig> {
    return this.request<IpQuarantineConfig>({
      method: 'GET',
      path: `${basePath(scope?.asSuperadmin)}/config`,
      query: tenantQuery(scope),
    });
  }

  async updateConfig(
    config: Partial<Omit<IpQuarantineConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
    scope?: QuarantineScope
  ): Promise<{ success: boolean; config: IpQuarantineConfig }> {
    return this.request({
      method: 'PUT',
      path: `${basePath(scope?.asSuperadmin)}/config`,
      query: tenantQuery(scope),
      body: config,
    });
  }
}
