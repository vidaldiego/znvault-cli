// Path: src/lib/client/lockdown.ts

/**
 * Lockdown and threat management client
 */

import { HttpClient } from './http.js';
import type {
  LockdownStatus,
  ThreatEvent,
  LockdownHistoryEntry,
  PaginatedResponse,
} from '../../types/index.js';

export class LockdownClient extends HttpClient {
  async getStatus(): Promise<LockdownStatus> {
    return this.request<LockdownStatus>({
      method: 'GET',
      path: '/v1/admin/lockdown/status',
    });
  }

  async trigger(level: 1 | 2 | 3 | 4, reason: string): Promise<{ success: boolean; status: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/lockdown/trigger',
      body: { level, reason },
    });
  }

  async clear(reason: string): Promise<{ success: boolean; previousStatus: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/lockdown/clear',
      body: { reason },
    });
  }

  async getHistory(limit?: number): Promise<LockdownHistoryEntry[]> {
    const response = await this.request<PaginatedResponse<LockdownHistoryEntry>>({
      method: 'GET',
      path: '/v1/admin/lockdown/history',
      query: { limit: limit ?? 50 },
    });
    return response.items;
  }

  async getThreats(options?: {
    category?: string;
    since?: string;
    limit?: number;
  }): Promise<ThreatEvent[]> {
    const response = await this.request<PaginatedResponse<ThreatEvent>>({
      method: 'GET',
      path: '/v1/admin/lockdown/threats',
      query: {
        category: options?.category,
        since: options?.since,
        limit: options?.limit ?? 100,
      },
    });
    return response.items;
  }
}
