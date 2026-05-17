// Path: src/lib/client/quarantine.ts

/**
 * IP Quarantine management client
 *
 * Routing: if `tenantId` is provided we hit `/v1/superadmin/quarantine/*`
 * (cross-tenant; requires superadmin role). Otherwise we hit `/v1/quarantine/*`
 * (tenant-scoped; tenant is derived from the JWT).
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
}

export interface ReleaseResult {
  success: boolean;
  message: string;
  releasedCount?: number;
}

function adminBase(tenantId: string | undefined): string {
  return tenantId !== undefined && tenantId !== '' ? '/v1/superadmin/quarantine' : '/v1/quarantine';
}

export class QuarantineClient extends HttpClient {
  async list(options?: ListQuarantineOptions): Promise<PaginatedResponse<IpQuarantine>> {
    return this.request<PaginatedResponse<IpQuarantine>>({
      method: 'GET',
      path: adminBase(options?.tenantId),
      query: {
        status: options?.status,
        tenantId: options?.tenantId,
        includeExpired: options?.includeExpired,
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
      },
    });
  }

  async getById(id: string, tenantId?: string): Promise<IpQuarantine> {
    return this.request<IpQuarantine>({
      method: 'GET',
      path: `${adminBase(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async release(id: string, reason: string, tenantId?: string): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `${adminBase(tenantId)}/${id}/release`,
      query: tenantId ? { tenantId } : undefined,
      body: { reason },
    });
  }

  async releaseIp(ip: string, reason: string, tenantId?: string): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `${adminBase(tenantId)}/ip/${encodeURIComponent(ip)}/release`,
      query: tenantId ? { tenantId } : undefined,
      body: { reason },
    });
  }

  async getHistory(
    ip: string,
    options?: { limit?: number; tenantId?: string }
  ): Promise<{ ip: string; failures: IpFailureHistory[] }> {
    return this.request({
      method: 'GET',
      path: `${adminBase(options?.tenantId)}/ip/${encodeURIComponent(ip)}/history`,
      query: {
        limit: options?.limit ?? 100,
        tenantId: options?.tenantId,
      },
    });
  }

  async getStats(tenantId?: string): Promise<IpQuarantineStats> {
    return this.request<IpQuarantineStats>({
      method: 'GET',
      path: `${adminBase(tenantId)}/stats`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getConfig(tenantId?: string): Promise<IpQuarantineConfig> {
    return this.request<IpQuarantineConfig>({
      method: 'GET',
      path: `${adminBase(tenantId)}/config`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async updateConfig(
    config: Partial<Omit<IpQuarantineConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
    tenantId?: string
  ): Promise<{ success: boolean; config: IpQuarantineConfig }> {
    return this.request({
      method: 'PUT',
      path: `${adminBase(tenantId)}/config`,
      query: tenantId ? { tenantId } : undefined,
      body: config,
    });
  }
}
