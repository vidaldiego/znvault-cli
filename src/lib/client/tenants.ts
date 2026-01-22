// Path: src/lib/client/tenants.ts

/**
 * Tenant management client
 */

import { HttpClient } from './http.js';
import type {
  Tenant,
  TenantWithUsage,
  TenantUsage,
  PaginatedResponse,
} from '../../types/index.js';

export class TenantsClient extends HttpClient {
  async list(options?: {
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
    return response.items;
  }

  async create(data: {
    id: string;
    name: string;
    maxSecrets?: number;
    maxKmsKeys?: number;
    contactEmail?: string;
  }): Promise<Tenant> {
    const response = await this.request<{ success: boolean; data: Tenant }>({
      method: 'POST',
      path: '/v1/tenants',
      body: data,
    });
    return response.data;
  }

  async getById(id: string, withUsage?: boolean): Promise<TenantWithUsage> {
    const response = await this.request<{ success: boolean; data: TenantWithUsage }>({
      method: 'GET',
      path: `/v1/tenants/${id}`,
      query: { withUsage },
    });
    return response.data;
  }

  async update(id: string, data: {
    name?: string;
    maxSecrets?: number;
    maxKmsKeys?: number;
    contactEmail?: string;
    status?: 'active' | 'suspended';
  }): Promise<Tenant> {
    const response = await this.request<{ success: boolean; data: Tenant }>({
      method: 'PATCH',
      path: `/v1/tenants/${id}`,
      body: data,
    });
    return response.data;
  }

  async deleteById(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/tenants/${id}`,
    });
  }

  async getUsage(id: string): Promise<TenantUsage> {
    return this.request<TenantUsage>({
      method: 'GET',
      path: `/v1/tenants/${id}/usage`,
    });
  }
}
