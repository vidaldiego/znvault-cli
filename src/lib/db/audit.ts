// Path: src/lib/db/audit.ts

/**
 * Audit log operations
 */

import type { AuditEntry, AuditVerifyResult } from '../../types/index.js';
import type { AuditLogRow } from './types.js';
import { BaseDBClient } from './client.js';

export class AuditOperations extends BaseDBClient {
  async listAudit(options?: {
    user?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.user) {
      sql += ` AND (client_cn = $${paramIndex} OR user_id = $${paramIndex})`;
      params.push(options.user);
      paramIndex++;
    }

    if (options?.action) {
      sql += ` AND action = $${paramIndex++}`;
      params.push(options.action);
    }

    if (options?.startDate) {
      sql += ` AND timestamp >= $${paramIndex++}`;
      params.push(new Date(options.startDate));
    }

    if (options?.endDate) {
      sql += ` AND timestamp <= $${paramIndex++}`;
      params.push(new Date(options.endDate));
    }

    sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
    params.push(options?.limit ?? 100);

    const rows = await this.query<AuditLogRow>(sql, params);

    return rows.map(r => ({
      id: r.id,
      ts: r.timestamp.toISOString(),
      clientCn: r.client_cn ?? '',
      action: r.action,
      resource: r.resource_type ? `${r.resource_type}/${r.resource_id ?? ''}` : '',
      statusCode: r.status_code,
      tenantId: r.tenant_id ?? undefined,
      ip: r.ip_address ?? undefined,
    }));
  }

  verifyAuditChain(): Promise<AuditVerifyResult> {
    return Promise.resolve({ valid: false, status: 'unverifiable', completed: false,
      readEntries: 0, authenticatedEntries: 0, unverifiedEntries: 0, checkedEntries: 0,
      reasons: ['local_verification_unavailable'],
      message: 'Local database mode cannot authenticate audit HMACs. Use the superadmin API snapshot check.' });
  }
}
