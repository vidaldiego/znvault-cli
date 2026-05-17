// Path: src/lib/client/users.ts

/**
 * User and superadmin management client
 */

import { HttpClient } from './http.js';
import type { User, Superadmin, PaginatedResponse } from '../../types/index.js';
import type { MessageResponse } from './types.js';

export class UsersClient extends HttpClient {
  async list(options?: {
    tenantId?: string;
    role?: string;
    status?: string;
  }): Promise<User[]> {
    const response = await this.request<PaginatedResponse<User>>({
      method: 'GET',
      path: '/v1/users',
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
  }): Promise<User> {
    return this.request<User>({
      method: 'POST',
      path: '/v1/users',
      body: data,
    });
  }

  async getById(id: string): Promise<User> {
    return this.request<User>({
      method: 'GET',
      path: `/v1/users/${id}`,
    });
  }

  async update(id: string, data: {
    email?: string;
    password?: string;
    role?: 'user' | 'admin';
    status?: 'active' | 'disabled';
  }): Promise<User> {
    return this.request<User>({
      method: 'PUT',
      path: `/v1/users/${id}`,
      body: data,
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.request<unknown>({
      method: 'DELETE',
      path: `/v1/users/${id}`,
    });
  }

  async unlock(id: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'PUT',
      path: `/v1/users/${id}`,
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
      ? `/v1/superadmin/users/${id}/reset-password`
      : `/v1/users/${id}/reset-password`;
    return this.request<MessageResponse>({
      method: 'POST',
      path,
      body: { newPassword },
    });
  }

  async disableTotp(id: string): Promise<MessageResponse> {
    return this.request<MessageResponse>({
      method: 'POST',
      path: `/v1/users/${id}/totp/disable`,
    });
  }
}

export class SuperadminsClient extends HttpClient {
  async list(): Promise<Superadmin[]> {
    const usersClient = new UsersClient();
    const users = await usersClient.list({ role: 'superadmin' });
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
