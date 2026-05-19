// Path: src/lib/client/users.ts

/**
 * User and superadmin management client
 *
 * Routing:
 *   - `asSuperadmin: true` → `/v1/superadmin/users*` (cross-tenant; used
 *     under `znvault superadmin user`).
 *   - otherwise → `/v1/users*` (tenant principal; tenant derived from JWT).
 *
 * The server rejects superadmin principals on `/v1/users*` with
 * "Superadmins must use /v1/superadmin/* routes" — so every method that can
 * be invoked from the superadmin namespace accepts an explicit
 * `asSuperadmin` switch rather than relying on tenant-id truthiness.
 */

import { HttpClient } from './http.js';
import type { User, Superadmin, PaginatedResponse } from '../../types/index.js';
import type { MessageResponse } from './types.js';

const TENANT_BASE = '/v1/users';
const ADMIN_BASE = '/v1/superadmin/users';

function basePath(asSuperadmin?: boolean): string {
  return asSuperadmin ? ADMIN_BASE : TENANT_BASE;
}

export class UsersClient extends HttpClient {
  async list(options?: {
    tenantId?: string;
    role?: string;
    status?: string;
    asSuperadmin?: boolean;
  }): Promise<User[]> {
    const response = await this.request<PaginatedResponse<User>>({
      method: 'GET',
      path: basePath(options?.asSuperadmin),
      query: {
        tenantId: options?.tenantId,
        role: options?.role,
        status: options?.status,
        pageSize: 1000,
      },
    });
    return response.items;
  }

  async create(data: {
    username: string;
    password: string;
    email?: string;
    tenantId?: string;
    role?: 'user' | 'admin';
    asSuperadmin?: boolean;
  }): Promise<User> {
    const { asSuperadmin, ...body } = data;
    return this.request<User>({
      method: 'POST',
      path: basePath(asSuperadmin),
      body,
    });
  }

  async getById(id: string, opts?: { asSuperadmin?: boolean }): Promise<User> {
    return this.request<User>({
      method: 'GET',
      path: `${basePath(opts?.asSuperadmin)}/${id}`,
    });
  }

  async update(id: string, data: {
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'disabled';
  }, opts?: { asSuperadmin?: boolean }): Promise<User> {
    return this.request<User>({
      method: 'PUT',
      path: `${basePath(opts?.asSuperadmin)}/${id}`,
      body: data,
    });
  }

  async deleteById(id: string, opts?: { asSuperadmin?: boolean }): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `${basePath(opts?.asSuperadmin)}/${id}`,
    });
  }

  async unlock(id: string, opts?: { asSuperadmin?: boolean }): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'PUT',
      path: `${basePath(opts?.asSuperadmin)}/${id}`,
      body: { status: 'active', failedAttempts: 0, lockedUntil: null },
    });
  }

  /**
   * Reset a user's password.
   *
   * Routing:
   *   - `asSuperadmin: true` → `/v1/superadmin/users/:id/reset-password` (cross-tenant)
   *   - otherwise → `/v1/users/:id/reset-password` (tenant admin, same tenant only)
   */
  async resetPassword(
    id: string,
    newPassword: string,
    opts?: { asSuperadmin?: boolean }
  ): Promise<MessageResponse> {
    const path = opts?.asSuperadmin
      ? `${ADMIN_BASE}/${id}/reset-password`
      : `${TENANT_BASE}/${id}/reset-password`;
    return this.request<MessageResponse>({
      method: 'POST',
      path,
      body: { newPassword },
    });
  }

  /**
   * Disable TOTP/2FA for a user.
   *
   * Only the tenant route (`/v1/users/:id/totp/disable`) exists today; the
   * server enforces tenant scoping. Superadmins disabling TOTP across
   * tenants must do so via dashboard or local-mode CLI.
   */
  async disableTotp(id: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `${TENANT_BASE}/${id}/totp/disable`,
    });
  }
}

export class SuperadminsClient extends HttpClient {
  async list(): Promise<Superadmin[]> {
    const usersClient = new UsersClient();
    // Listing superadmin role members requires the admin namespace.
    const users = await usersClient.list({ role: 'superadmin', asSuperadmin: true });
    return users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      status: u.status,
      totpEnabled: u.totpEnabled,
      failedAttempts: u.failedAttempts,
      lockedUntil: u.lockedUntil,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    }));
  }

  async create(data: {
    username: string;
    password: string;
    email?: string;
  }): Promise<Superadmin> {
    return this.request<Superadmin>({
      method: 'POST',
      path: '/v1/superadmins',
      body: data,
    });
  }

  async resetPassword(username: string, password: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/password`,
      body: { password },
    });
  }

  async unlock(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/unlock`,
    });
  }

  async disable(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/disable`,
    });
  }

  async enable(username: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/superadmins/${username}/enable`,
    });
  }
}
