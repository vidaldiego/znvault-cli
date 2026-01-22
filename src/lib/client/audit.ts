// Path: src/lib/client/audit.ts

/**
 * Audit log client
 */

import { HttpClient } from './http.js';
import type {
  AuditEntry,
  AuditVerifyResult,
  PaginatedResponse,
} from '../../types/index.js';

export class AuditClient extends HttpClient {
  async list(options?: {
    user?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const response = await this.request<PaginatedResponse<AuditEntry>>({
      method: 'GET',
      path: '/v1/audit',
      query: {
        client_cn: options?.user,
        action: options?.action,
        start_date: options?.startDate,
        end_date: options?.endDate,
        limit: options?.limit ?? 100,
      },
    });
    return response.items;
  }

  async verifyChain(): Promise<AuditVerifyResult> {
    return this.request<AuditVerifyResult>({
      method: 'GET',
      path: '/v1/audit/verify',
    });
  }

  async export(options?: {
    format?: 'json' | 'csv';
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    return this.request<string>({
      method: 'GET',
      path: '/v1/audit',
      query: {
        format: options?.format ?? 'json',
        start_date: options?.startDate,
        end_date: options?.endDate,
        limit: 10000,
      },
    });
  }
}
