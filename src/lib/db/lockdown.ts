// Path: src/lib/db/lockdown.ts

/**
 * Lockdown and security operations
 */

import type { LockdownStatus, ThreatEvent, LockdownHistoryEntry } from '../../types/index.js';
import type { LockdownRow, LockdownHistoryRow, ThreatEventRow } from './types.js';
import { BaseDBClient } from './client.js';

export class LockdownOperations extends BaseDBClient {
  async getLockdownStatus(): Promise<LockdownStatus> {
    const row = await this.queryOne<LockdownRow>(
      'SELECT * FROM lockdown_state ORDER BY updated_at DESC LIMIT 1'
    );

    if (!row) {
      return {
        scope: 'SYSTEM',
        status: 'NORMAL',
        escalationCount: 0,
      };
    }

    return {
      scope: row.scope as 'SYSTEM' | 'TENANT',
      tenantId: row.tenant_id ?? undefined,
      status: row.status as 'NORMAL' | 'ALERT' | 'RESTRICT' | 'LOCKDOWN' | 'PANIC',
      reason: row.reason ?? undefined,
      triggeredAt: row.triggered_at?.toISOString(),
      triggeredBy: row.triggered_by ?? undefined,
      escalationCount: row.escalation_count,
    };
  }

  async getLockdownHistory(limit: number = 50): Promise<LockdownHistoryEntry[]> {
    const rows = await this.query<LockdownHistoryRow>(
      'SELECT * FROM lockdown_history ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    return rows.map(r => ({
      id: r.id,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      transitionReason: r.transition_reason,
      changedByUserId: r.changed_by_user_id ?? undefined,
      changedBySystem: r.changed_by_system,
      ts: r.created_at.toISOString(),
    }));
  }

  async getThreats(options?: { category?: string; since?: string; limit?: number }): Promise<ThreatEvent[]> {
    let sql = 'SELECT * FROM threat_events WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(options.category);
    }

    if (options?.since) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(new Date(options.since));
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(options?.limit ?? 100);

    const rows = await this.query<ThreatEventRow>(sql, params);

    return rows.map(r => ({
      id: r.id,
      ts: r.created_at.toISOString(),
      tenantId: r.tenant_id ?? undefined,
      userId: r.user_id ?? undefined,
      ip: r.ip,
      userAgent: r.user_agent ?? undefined,
      category: r.category,
      signal: r.signal,
      suggestedLevel: r.suggested_level,
      endpoint: r.endpoint,
      method: r.method,
      statusCode: r.status_code,
      escalated: r.escalated,
    }));
  }
}
