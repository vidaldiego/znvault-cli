// Path: src/lib/client/apikeys.ts

/**
 * API Key management client
 *
 * Routing policy:
 *   - When `tenantId` is supplied, the caller is acting as a superadmin and
 *     we target `/v1/superadmin/api-keys/*` (the cross-tenant surface).
 *   - When `tenantId` is omitted, the caller is a tenant principal and we
 *     target `/auth/api-keys/*` (tenant derived from JWT).
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

function basePath(tenantId?: string): string {
  return tenantId ? ADMIN_BASE : TENANT_BASE;
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
  }): Promise<CreateAPIKeyResponse> {
    return this.request<CreateAPIKeyResponse>({
      method: 'POST',
      path: basePath(data.tenantId),
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

  async list(tenantId?: string): Promise<ListAPIKeysResponse> {
    return this.request<ListAPIKeysResponse>({
      method: 'GET',
      path: basePath(tenantId),
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getById(id: string, tenantId?: string): Promise<APIKey> {
    return this.request<APIKey>({
      method: 'GET',
      path: `${basePath(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async deleteById(id: string, tenantId?: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `${basePath(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async rotate(id: string, name?: string, tenantId?: string): Promise<RotateAPIKeyResponse> {
    return this.request<RotateAPIKeyResponse>({
      method: 'POST',
      path: `${basePath(tenantId)}/${id}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: name ? { name } : {},
    });
  }

  async updatePermissions(id: string, permissions: string[], tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId)}/${id}/permissions`,
      query: tenantId ? { tenantId } : undefined,
      body: { permissions },
    });
    return response.apiKey;
  }

  async updateConditions(id: string, conditions: Record<string, unknown>, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId)}/${id}/conditions`,
      query: tenantId ? { tenantId } : undefined,
      body: { conditions },
    });
    return response.apiKey;
  }

  async setEnabled(id: string, enabled: boolean, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `${basePath(tenantId)}/${id}/enabled`,
      query: tenantId ? { tenantId } : undefined,
      body: { enabled },
    });
    return response.apiKey;
  }

  async getPolicies(id: string, tenantId?: string): Promise<{ policies: APIKeyPolicyAttachment[] }> {
    return this.request<{ policies: APIKeyPolicyAttachment[] }>({
      method: 'GET',
      path: `${basePath(tenantId)}/${id}/policies`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async attachPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `${basePath(tenantId)}/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async detachPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `${basePath(tenantId)}/${keyId}/policies/${policyId}`,
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
