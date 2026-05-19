// Path: src/lib/client/audit.ts

/**
 * Audit log client
 *
 * Routing:
 *   - `asSuperadmin: true` → `/v1/superadmin/audit*` (cross-tenant; required
 *     when the caller is a superadmin under `znvault superadmin audit`).
 *   - otherwise → `/v1/audit*` (tenant-scoped; tenant derived from JWT).
 *
 * Superadmins MUST use the `/v1/superadmin/*` surface; the tenant-scoped
 * surface rejects superadmin principals with
 * "Superadmins must use /v1/superadmin/* routes".
 *
 * Note: the tenant and superadmin namespaces use different query schemas:
 *   - tenant `/v1/audit`: snake_case (`client_cn`, `start_date`, `end_date`)
 *   - admin `/v1/superadmin/audit`: camelCase (`username`, `startDate`,
 *     `endDate`); also supports `tenantId` filter.
 * The admin namespace exposes only `GET /v1/superadmin/audit` (list) and
 * `GET /v1/superadmin/audit/stats`. There is no superadmin /verify or
 * /export endpoint — so for those operations the client routes through the
 * superadmin list path with an optional `tenantId` filter when in admin
 * mode, and through the tenant `/v1/audit/verify` & `/v1/audit/export`
 * routes otherwise.
 */

import { HttpClient } from './http.js';
import type {
  AuditEntry,
  AuditVerifyResult,
  PaginatedResponse,
} from '../../types/index.js';

const TENANT_BASE = '/v1/audit';
const ADMIN_BASE = '/v1/superadmin/audit';

export interface AuditScopeOptions {
  asSuperadmin?: boolean;
}

export class AuditClient extends HttpClient {
  async list(options?: {
    user?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    tenantId?: string;
    asSuperadmin?: boolean;
  }): Promise<AuditEntry[]> {
    const query: Record<string, string | number | boolean | undefined> = options?.asSuperadmin
      ? {
          username: options.user,
          action: options.action,
          startDate: options.startDate,
          endDate: options.endDate,
          limit: options.limit ?? 100,
          tenantId: options.tenantId,
        }
      : {
          client_cn: options?.user,
          action: options?.action,
          start_date: options?.startDate,
          end_date: options?.endDate,
          limit: options?.limit ?? 100,
        };

    const response = await this.request<PaginatedResponse<AuditEntry>>({
      method: 'GET',
      path: options?.asSuperadmin ? ADMIN_BASE : TENANT_BASE,
      query,
    });
    return response.items;
  }

  /**
   * Verify the HMAC chain integrity of audit logs.
   *
   * Only the tenant-scoped surface exposes `/v1/audit/verify`. When called
   * with `asSuperadmin: true`, the request still targets `/v1/audit/verify`
   * which will reject a pure superadmin principal — surface that error to
   * the caller rather than silently no-op.
   */
  async verifyChain(_opts?: AuditScopeOptions): Promise<AuditVerifyResult> {
    return this.request<AuditVerifyResult>({
      method: 'GET',
      path: `${TENANT_BASE}/verify`,
    });
  }

  /**
   * Export audit logs.
   *
   * - In tenant mode, hits `/v1/audit/export` (CSV/JSON download).
   * - In superadmin mode, the server only exposes `/v1/superadmin/audit`
   *   (list) — there is no dedicated export endpoint. We hit the list
   *   endpoint with a high `limit` so the caller can still serialize the
   *   resulting JSON to disk. CSV is not supported in admin mode.
   */
  async export(options?: {
    format?: 'json' | 'csv';
    startDate?: string;
    endDate?: string;
    tenantId?: string;
    asSuperadmin?: boolean;
  }): Promise<string> {
    if (options?.asSuperadmin) {
      const response = await this.request<PaginatedResponse<AuditEntry>>({
        method: 'GET',
        path: ADMIN_BASE,
        query: {
          startDate: options.startDate,
          endDate: options.endDate,
          tenantId: options.tenantId,
          limit: 10000,
        },
      });
      return JSON.stringify(response.items);
    }

    return this.request<string>({
      method: 'GET',
      path: `${TENANT_BASE}/export`,
      query: {
        format: options?.format ?? 'json',
        start_date: options?.startDate,
        end_date: options?.endDate,
      },
    });
  }

  /**
   * Audit statistics summary.
   *
   * Available on both tenant (`/v1/audit/stats`) and admin
   * (`/v1/superadmin/audit/stats`) surfaces.
   */
  async getStats(opts?: AuditScopeOptions & { tenantId?: string }): Promise<unknown> {
    return this.request<unknown>({
      method: 'GET',
      path: opts?.asSuperadmin ? `${ADMIN_BASE}/stats` : `${TENANT_BASE}/stats`,
      query: opts?.tenantId ? { tenantId: opts.tenantId } : undefined,
    });
  }
}
