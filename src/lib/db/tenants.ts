// Path: src/lib/db/tenants.ts

/**
 * Tenant database operations
 */

import type { TenantWithUsage, TenantUsage } from '../../types/index.js';
import type { TenantRow } from './types.js';
import { BaseDBClient } from './client.js';

export class TenantOperations extends BaseDBClient {
  async listTenants(options?: { status?: string; withUsage?: boolean }): Promise<TenantWithUsage[]> {
    const withUsage = options?.withUsage ?? false;

    let sql: string;
    if (withUsage) {
      sql = `
        SELECT t.id, t.name, t.status, t.max_secrets, t.max_kms_keys, t.contact_email,
               t.created_at, t.updated_at,
               (SELECT COUNT(*) FROM secrets WHERE tenant = t.id) as secrets_count,
               (SELECT COUNT(*) FROM kms_keys WHERE tenant_id = t.id) as kms_keys_count,
               (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as users_count,
               (SELECT COUNT(*) FROM api_keys WHERE tenant_id = t.id) as api_keys_count
        FROM tenants t
      `;
    } else {
      sql = `
        SELECT t.id, t.name, t.status, t.max_secrets, t.max_kms_keys, t.contact_email,
               t.created_at, t.updated_at
        FROM tenants t
      `;
    }

    const params: unknown[] = [];

    if (options?.status) {
      sql += ' WHERE t.status = $1';
      params.push(options.status);
    }

    sql += ' ORDER BY t.name';

    const rows = await this.query<TenantRow>(sql, params);

    return rows.map(r => {
      const tenant: TenantWithUsage = {
        id: r.id,
        name: r.name,
        status: r.status as 'active' | 'suspended' | 'archived',
        maxSecrets: r.max_secrets ?? undefined,
        maxKmsKeys: r.max_kms_keys ?? undefined,
        contactEmail: r.contact_email ?? undefined,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };

      if (withUsage) {
        tenant.usage = {
          secretsCount: parseInt(r.secrets_count ?? '0', 10),
          kmsKeysCount: parseInt(r.kms_keys_count ?? '0', 10),
          storageUsedMb: 0,
          usersCount: parseInt(r.users_count ?? '0', 10),
          apiKeysCount: parseInt(r.api_keys_count ?? '0', 10),
        };
      }

      return tenant;
    });
  }

  async getTenant(id: string, withUsage?: boolean): Promise<TenantWithUsage | null> {
    const row = await this.queryOne<{
      id: string;
      name: string;
      status: string;
      max_secrets: number | null;
      max_kms_keys: number | null;
      contact_email: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM tenants WHERE id = $1', [id]);

    if (!row) return null;

    const tenant: TenantWithUsage = {
      id: row.id,
      name: row.name,
      status: row.status as 'active' | 'suspended' | 'archived',
      maxSecrets: row.max_secrets ?? undefined,
      maxKmsKeys: row.max_kms_keys ?? undefined,
      contactEmail: row.contact_email ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };

    if (withUsage) {
      tenant.usage = await this.getTenantUsage(id);
    }

    return tenant;
  }

  async getTenantUsage(id: string): Promise<TenantUsage> {
    const secrets = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM secrets WHERE tenant = $1',
      [id]
    );
    const kmsKeys = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM kms_keys WHERE tenant_id = $1',
      [id]
    );
    const users = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1',
      [id]
    );
    const apiKeys = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM api_keys WHERE tenant_id = $1',
      [id]
    );

    return {
      secretsCount: parseInt(secrets?.count ?? '0', 10),
      kmsKeysCount: parseInt(kmsKeys?.count ?? '0', 10),
      storageUsedMb: 0,
      usersCount: parseInt(users?.count ?? '0', 10),
      apiKeysCount: parseInt(apiKeys?.count ?? '0', 10),
    };
  }
}
