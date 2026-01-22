// Path: src/lib/client/apikeys.ts

/**
 * API Key management client
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

  async list(tenantId?: string): Promise<ListAPIKeysResponse> {
    return this.request<ListAPIKeysResponse>({
      method: 'GET',
      path: '/auth/api-keys',
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async getById(id: string, tenantId?: string): Promise<APIKey> {
    return this.request<APIKey>({
      method: 'GET',
      path: `/auth/api-keys/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async deleteById(id: string, tenantId?: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/auth/api-keys/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async rotate(id: string, name?: string, tenantId?: string): Promise<RotateAPIKeyResponse> {
    return this.request<RotateAPIKeyResponse>({
      method: 'POST',
      path: `/auth/api-keys/${id}/rotate`,
      query: tenantId ? { tenantId } : undefined,
      body: name ? { name } : {},
    });
  }

  async updatePermissions(id: string, permissions: string[], tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/permissions`,
      query: tenantId ? { tenantId } : undefined,
      body: { permissions },
    });
    return response.apiKey;
  }

  async updateConditions(id: string, conditions: Record<string, unknown>, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/conditions`,
      query: tenantId ? { tenantId } : undefined,
      body: { conditions },
    });
    return response.apiKey;
  }

  async setEnabled(id: string, enabled: boolean, tenantId?: string): Promise<APIKey> {
    const response = await this.request<{ apiKey: APIKey; message: string }>({
      method: 'PATCH',
      path: `/auth/api-keys/${id}/enabled`,
      query: tenantId ? { tenantId } : undefined,
      body: { enabled },
    });
    return response.apiKey;
  }

  async getPolicies(id: string, tenantId?: string): Promise<{ policies: APIKeyPolicyAttachment[] }> {
    return this.request<{ policies: APIKeyPolicyAttachment[] }>({
      method: 'GET',
      path: `/auth/api-keys/${id}/policies`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async attachPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/auth/api-keys/${keyId}/policies/${policyId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async detachPolicy(keyId: string, policyId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `/auth/api-keys/${keyId}/policies/${policyId}`,
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
