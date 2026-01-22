// Path: src/lib/db/users.ts

/**
 * User database operations
 */

import type { User, Superadmin } from '../../types/index.js';
import type { UserRow } from './types.js';
import { BaseDBClient } from './client.js';

export class UserOperations extends BaseDBClient {
  async listUsers(options?: { tenantId?: string; role?: string; status?: string }): Promise<User[]> {
    let sql = `
      SELECT id, username, email, role, tenant_id, status, totp_enabled,
             failed_attempts, locked_until, last_login, created_at, updated_at
      FROM users
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.tenantId) {
      sql += ` AND tenant_id = $${paramIndex++}`;
      params.push(options.tenantId);
    }

    if (options?.role) {
      sql += ` AND role = $${paramIndex++}`;
      params.push(options.role);
    }

    if (options?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(options.status);
    }

    sql += ' ORDER BY username';

    const rows = await this.query<UserRow>(sql, params);

    return rows.map(r => ({
      id: r.id,
      username: r.username,
      email: r.email ?? undefined,
      role: r.role as 'user' | 'admin' | 'superadmin',
      tenantId: r.tenant_id ?? undefined,
      status: r.status as 'active' | 'disabled' | 'locked',
      totpEnabled: r.totp_enabled,
      failedAttempts: r.failed_attempts,
      lockedUntil: r.locked_until?.toISOString(),
      lastLogin: r.last_login?.toISOString(),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async getUser(id: string): Promise<User | null> {
    const row = await this.queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);

    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      email: row.email ?? undefined,
      role: row.role as 'user' | 'admin' | 'superadmin',
      tenantId: row.tenant_id ?? undefined,
      status: row.status as 'active' | 'disabled' | 'locked',
      totpEnabled: row.totp_enabled,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until?.toISOString(),
      lastLogin: row.last_login?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const row = await this.queryOne<UserRow>(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      email: row.email ?? undefined,
      role: row.role as 'user' | 'admin' | 'superadmin',
      tenantId: row.tenant_id ?? undefined,
      status: row.status as 'active' | 'disabled' | 'locked',
      totpEnabled: row.totp_enabled,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until?.toISOString(),
      lastLogin: row.last_login?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async listSuperadmins(): Promise<Superadmin[]> {
    const users = await this.listUsers({ role: 'superadmin' });
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
}
