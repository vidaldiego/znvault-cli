// Path: src/lib/client/policies.ts

/**
 * ABAC Policy management client
 */

import { HttpClient } from './http.js';
import type {
  Policy,
  PolicyListResponse,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyTestRequest,
  PolicyTestResult,
} from '../../types/index.js';
import type {
  MessageResponse,
  PermissionsResponse,
  ValidatePermissionsResponse,
  ValidatePolicyResponse,
  PolicyAttachmentsResponse,
} from './types.js';

export class PoliciesClient extends HttpClient {
  async list(options?: {
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

  async getById(id: string): Promise<Policy> {
    return this.request<Policy>({
      method: 'GET',
      path: `/v1/policies/${id}`,
    });
  }

  async create(data: CreatePolicyInput): Promise<Policy> {
    return this.request<Policy>({
      method: 'POST',
      path: '/v1/policies',
      body: data,
    });
  }

  async update(id: string, data: UpdatePolicyInput): Promise<Policy> {
    return this.request<Policy>({
      method: 'PATCH',
      path: `/v1/policies/${id}`,
      body: data,
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/policies/${id}`,
    });
  }

  async toggle(id: string, enabled: boolean): Promise<Policy> {
    return this.request<Policy>({
      method: 'POST',
      path: `/v1/policies/${id}/toggle`,
      body: { enabled },
    });
  }

  async validate(policy: CreatePolicyInput): Promise<ValidatePolicyResponse> {
    return this.request<ValidatePolicyResponse>({
      method: 'POST',
      path: '/v1/policies/validate',
      body: policy,
    });
  }

  async getAttachments(policyId: string): Promise<PolicyAttachmentsResponse> {
    return this.request<PolicyAttachmentsResponse>({
      method: 'GET',
      path: `/v1/policies/${policyId}/attachments`,
    });
  }

  async attachToUser(policyId: string, userId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/policies/${policyId}/attach/user`,
      body: { userId },
    });
  }

  async attachToRole(policyId: string, roleId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/policies/${policyId}/attach/role`,
      body: { roleId },
    });
  }

  async detachFromUser(policyId: string, userId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `/v1/policies/${policyId}/attach/user/${userId}`,
    });
  }

  async detachFromRole(policyId: string, roleId: string): Promise<MessageResponse> {
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

  async test(request: PolicyTestRequest): Promise<PolicyTestResult> {
    return this.request<PolicyTestResult>({
      method: 'POST',
      path: '/v1/policies/test',
      body: request,
    });
  }
}

export class PermissionsClient extends HttpClient {
  async list(category?: string): Promise<PermissionsResponse> {
    return this.request<PermissionsResponse>({
      method: 'GET',
      path: '/v1/permissions',
      query: category ? { category } : undefined,
    });
  }

  async validate(permissions: string[]): Promise<ValidatePermissionsResponse> {
    return this.request<ValidatePermissionsResponse>({
      method: 'POST',
      path: '/v1/permissions/validate',
      body: { permissions },
    });
  }
}
