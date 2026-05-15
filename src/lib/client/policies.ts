// Path: src/lib/client/policies.ts

/**
 * ABAC Policy management client
 *
 * Routing policy:
 *   - When `tenantId` is supplied, target `/v1/superadmin/policies/*`
 *     (cross-tenant superadmin surface).
 *   - When `tenantId` is omitted, target `/v1/policies/*` (tenant principal,
 *     tenant derived from JWT).
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

const TENANT_BASE = '/v1/policies';
const ADMIN_BASE = '/v1/superadmin/policies';

function basePath(tenantId?: string): string {
  return tenantId ? ADMIN_BASE : TENANT_BASE;
}

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
      path: basePath(options?.tenantId),
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

  async getById(id: string, tenantId?: string): Promise<Policy> {
    return this.request<Policy>({
      method: 'GET',
      path: `${basePath(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async create(data: CreatePolicyInput): Promise<Policy> {
    // Body carries tenantId for tenant-scoped routes (server reads from JWT
    // and ignores body field) and for admin routes we promote it to query.
    const tenantId = (data as { tenantId?: string }).tenantId;
    return this.request<Policy>({
      method: 'POST',
      path: basePath(tenantId),
      query: tenantId ? { tenantId } : undefined,
      body: data,
    });
  }

  async update(id: string, data: UpdatePolicyInput, tenantId?: string): Promise<Policy> {
    return this.request<Policy>({
      method: 'PATCH',
      path: `${basePath(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
      body: data,
    });
  }

  async deleteById(id: string, tenantId?: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `${basePath(tenantId)}/${id}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async toggle(id: string, enabled: boolean, tenantId?: string): Promise<Policy> {
    return this.request<Policy>({
      method: 'POST',
      path: `${basePath(tenantId)}/${id}/toggle`,
      query: tenantId ? { tenantId } : undefined,
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

  async getAttachments(policyId: string, tenantId?: string): Promise<PolicyAttachmentsResponse> {
    return this.request<PolicyAttachmentsResponse>({
      method: 'GET',
      path: `${basePath(tenantId)}/${policyId}/attachments`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async attachToUser(policyId: string, userId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `${basePath(tenantId)}/${policyId}/attach/user`,
      query: tenantId ? { tenantId } : undefined,
      body: { userId },
    });
  }

  async attachToRole(policyId: string, roleId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `${basePath(tenantId)}/${policyId}/attach/role`,
      query: tenantId ? { tenantId } : undefined,
      body: { roleId },
    });
  }

  async detachFromUser(policyId: string, userId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `${basePath(tenantId)}/${policyId}/attach/user/${userId}`,
      query: tenantId ? { tenantId } : undefined,
    });
  }

  async detachFromRole(policyId: string, roleId: string, tenantId?: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'DELETE',
      path: `${basePath(tenantId)}/${policyId}/attach/role/${roleId}`,
      query: tenantId ? { tenantId } : undefined,
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
