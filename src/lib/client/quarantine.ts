// Path: src/lib/client/quarantine.ts

/**
 * IP Quarantine management client
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

export class QuarantineClient extends HttpClient {
  /**
   * List quarantined IPs
   */
  async list(options?: ListQuarantineOptions): Promise<PaginatedResponse<IpQuarantine>> {
    return this.request<PaginatedResponse<IpQuarantine>>({
      method: 'GET',
      path: '/v1/quarantine',
      query: {
        status: options?.status,
        tenantId: options?.tenantId,
        includeExpired: options?.includeExpired,
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
      },
    });
  }

  /**
   * Get quarantine details by ID
   */
  async getById(id: string): Promise<IpQuarantine> {
    return this.request<IpQuarantine>({
      method: 'GET',
      path: `/v1/quarantine/${id}`,
    });
  }

  /**
   * Release a quarantine by ID
   */
  async release(id: string, reason: string): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `/v1/quarantine/${id}/release`,
      body: { reason },
    });
  }

  /**
   * Release all quarantines for an IP
   */
  async releaseIp(ip: string, reason: string, tenantId?: string): Promise<ReleaseResult> {
    return this.request<ReleaseResult>({
      method: 'POST',
      path: `/v1/quarantine/ip/${encodeURIComponent(ip)}/release`,
      body: { reason, tenantId },
    });
  }

  /**
   * Get failure history for an IP
   */
  async getHistory(ip: string, options?: { limit?: number; tenantId?: string }): Promise<{ ip: string; failures: IpFailureHistory[] }> {
    return this.request({
      method: 'GET',
      path: `/v1/quarantine/ip/${encodeURIComponent(ip)}/history`,
      query: {
        limit: options?.limit ?? 100,
        tenantId: options?.tenantId,
      },
    });
  }

  /**
   * Get quarantine statistics
   */
  async getStats(tenantId?: string): Promise<IpQuarantineStats> {
    return this.request<IpQuarantineStats>({
      method: 'GET',
      path: '/v1/quarantine/stats',
      query: { tenantId },
    });
  }

  /**
   * Get quarantine configuration
   */
  async getConfig(tenantId?: string): Promise<IpQuarantineConfig> {
    return this.request<IpQuarantineConfig>({
      method: 'GET',
      path: '/v1/quarantine/config',
      query: { tenantId },
    });
  }

  /**
   * Update quarantine configuration
   */
  async updateConfig(
    config: Partial<Omit<IpQuarantineConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
    tenantId?: string
  ): Promise<{ success: boolean; config: IpQuarantineConfig }> {
    return this.request({
      method: 'PUT',
      path: '/v1/quarantine/config',
      query: { tenantId },
      body: config,
    });
  }
}
