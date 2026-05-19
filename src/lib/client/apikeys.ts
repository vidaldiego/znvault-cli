// Path: src/lib/client/apikeys.ts

/**
 * API Key management client
 *
 * Routing policy:
 *   - When `tenantId` is supplied OR the caller passes `asSuperadmin: true`,
 *     we target `/v1/superadmin/api-keys/*` (the cross-tenant surface).
 *   - Otherwise, we target `/auth/api-keys/*` (tenant principal; tenant
 *     derived from JWT).
 *
 * The explicit `asSuperadmin` flag is required for `znvault superadmin
 * apikey list` (no `--tenant`): the tenant surface rejects pure superadmin
 * principals with "Superadmins must use /v1/superadmin/* routes".
 */

import { HttpClient } from './http.js';
import type {
  APIKey,
  CreateAPIKeyResponse,
  ListAPIKeysResponse,
  RotateAPIKeyResponse,
  APIKeySelfResponse,
  APIKeyPolicyAttachment,
} from '../../types/index.js';
import type { MessageResponse } from './types.js';

const TENANT_BASE = '/auth/api-keys';
const ADMIN_BASE = '/v1/superadmin/api-keys';

function basePath(tenantId?: string, asSuperadmin?: boolean): string {
  return tenantId || asSuperadmin ? ADMIN_BASE : TENANT_BASE;
}

export interface ApiKeyScope {
  asSuperadmin?: boolean;
}

export class ApiKeysClient extends HttpClient {
  async create(data: {
    name: string;
    description?: string;
    expiresInDays?: number;
    permissions: string[];
    tenantId?: string;
    ipAllowlist?: string[];
    conditions?: Record<string, unknown>;
    asSuperadmin?: boolean;
  }): Promise<CreateAPIKeyResponse> {
    return this.request<CreateAPIKeyResponse>({
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
      },
    });
  }

  async list(tenantId?: string, opts?: ApiKeyScope): Promise<ListAPIKeysResponse> {
    return this.request<ListAPIKeysResponse>({
      method: 'GET',
      path: basePath(tenantId, opts?.asSuperadmin),
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getById(id: string, tenantId?: string, opts?: ApiKeyScope): Promise<APIKey> {
    return this.request<APIKey>({
      method: 'GET',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async deleteById(id: string, tenantId?: string, opts?: ApiKeyScope): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async rotate(id: string, name?: string, tenantId?: string, opts?: ApiKeyScope): Promise<RotateAPIKeyResponse> {
    return this.request<RotateAPIKeyResponse>({
      method: 'POST',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: name ? { name } : {},
    });
  }

  async updatePermissions(id: string, permissions: string[], tenantId?: string, opts?: ApiKeyScope): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}/permissions`,
      query: tenantId ? { tenantId } : undefined,
      body: { permissions },
    });
    return response.apiKey;
  }

  async updateConditions(id: string, conditions: Record<string, unknown>, tenantId?: string, opts?: ApiKeyScope): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}/conditions`,
      query: tenantId ? { tenantId } : undefined,
      body: { conditions },
    });
    return response.apiKey;
  }

  async setEnabled(id: string, enabled: boolean, tenantId?: string, opts?: ApiKeyScope): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}/enabled`,
      query: tenantId ? { tenantId } : undefined,
      body: { enabled },
    });
    return response.apiKey;
  }

  async getPolicies(id: string, tenantId?: string, opts?: ApiKeyScope): Promise<{ policies: APIKeyPolicyAttachment[] }> {
    return this.request<{ policies: APIKeyPolicyAttachment[] }>({
      method: 'GET',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${id}/policies`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async attachPolicy(keyId: string, policyId: string, tenantId?: string, opts?: ApiKeyScope): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async detachPolicy(keyId: string, policyId: string, tenantId?: string, opts?: ApiKeyScope): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `${basePath(tenantId, opts?.asSuperadmin)}/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getSelf(): Promise<APIKeySelfResponse> {
    return this.request<APIKeySelfResponse>({
      method: 'GET',
      path: '/auth/api-keys/self',
    });
  }

  async rotateSelf(name?: string): Promise<RotateAPIKeyResponse & { expiresInDays: number }> {
    return this.request<RotateAPIKeyResponse & { expiresInDays: number }>({
      method: 'POST',
      path: '/auth/api-keys/self/rotate',
      body: name ? { name } : {},
    });
  }
}
