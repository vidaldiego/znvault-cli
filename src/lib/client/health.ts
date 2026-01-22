// Path: src/lib/client/health.ts

/**
 * Health and cluster client
 */

import { HttpClient } from './http.js';
import type { HealthResponse, ClusterStatus } from '../../types/index.js';

export class HealthClient extends HttpClient {
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: 'GET',
      path: '/v1/health',
      skipAuth: true,
    });
  }

  async leaderHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: 'GET',
      path: '/v1/health/leader',
      skipAuth: true,
    });
  }
}

export class ClusterClient extends HttpClient {
  async status(): Promise<ClusterStatus> {
    return this.request<ClusterStatus>({
      method: 'GET',
      path: '/v1/admin/cluster',
    });
  }

  async takeover(): Promise<{ success: boolean; message: string; nodeId: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/takeover',
    });
  }

  async promote(nodeId: string): Promise<{ success: boolean; message: string }> {
    return this.request({
      method: 'POST',
      path: `/v1/admin/cluster/nodes/${nodeId}/promote`,
    });
  }

  async release(): Promise<{ success: boolean; message: string }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/release',
    });
  }

  async maintenance(enable: boolean): Promise<{ success: boolean; maintenanceMode: boolean }> {
    return this.request({
      method: 'POST',
      path: '/v1/admin/cluster/maintenance',
      body: { enable },
    });
  }
}
