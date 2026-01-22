// Path: src/lib/db/health.ts

/**
 * Health and cluster status operations
 */

import type { HealthResponse, ClusterStatus, ClusterNode } from '../../types/index.js';
import { REDIS_PING_TIMEOUT_MS, REDIS_SENTINEL_TIMEOUT_MS } from '../constants.js';
import type { ManifestFile, HANodeRow } from './types.js';
import { BaseDBClient } from './client.js';

export class HealthOperations extends BaseDBClient {
  async health(): Promise<HealthResponse> {
    await this.connect();

    const dbTime = await this.queryOne<{ now: Date }>('SELECT NOW() as now');
    const version = await this.getVaultVersion();

    const haEnabled = process.env.HA_ENABLED === 'true';
    const nodeId = process.env.HA_NODE_ID ?? 'standalone';

    const pgStatus = await this.getPostgresStatus();
    const redisStatus = await this.getRedisStatus();

    let clusterSize = 1;
    let isLeader = false;
    if (haEnabled && redisStatus.status === 'ok') {
      const clusterInfo = await this.getClusterInfoFromRedis();
      clusterSize = clusterInfo.nodeCount;
      isLeader = clusterInfo.leaderNodeId === nodeId;
    }

    return {
      status: 'ok',
      version,
      uptime: process.uptime(),
      timestamp: dbTime?.now.toISOString() ?? new Date().toISOString(),
      database: pgStatus,
      redis: redisStatus.status !== 'unavailable' ? redisStatus : undefined,
      ha: haEnabled ? {
        enabled: true,
        nodeId,
        isLeader,
        clusterSize,
      } : undefined,
    };
  }

  async clusterStatus(): Promise<ClusterStatus> {
    await this.connect();

    const haEnabled = process.env.HA_ENABLED === 'true';
    const nodeId = process.env.HA_NODE_ID ?? 'unknown';

    let nodes: ClusterNode[] = [];
    try {
      const dbNodes = await this.query<HANodeRow>(`
        SELECT node_id, advertised_host, advertised_port, is_leader, last_heartbeat, status
        FROM ha_nodes
        ORDER BY node_id
      `);

      nodes = dbNodes.map(n => ({
        nodeId: n.node_id,
        host: n.advertised_host,
        port: n.advertised_port,
        isLeader: n.is_leader,
        isHealthy: n.status === 'healthy',
        lastHeartbeat: n.last_heartbeat.toISOString(),
      }));
    } catch {
      // Table might not exist in non-HA setups
    }

    const leader = nodes.find(n => n.isLeader);

    return {
      enabled: haEnabled,
      nodeId,
      isLeader: leader?.nodeId === nodeId,
      leaderNodeId: leader?.nodeId ?? null,
      nodes,
    };
  }

  private async getVaultVersion(): Promise<string> {
    try {
      const fs = await import('node:fs');
      const manifestPaths = [
        '/opt/znvault/current/MANIFEST.json',
        '/opt/znvault/current/manifest.json',
      ];
      for (const manifestPath of manifestPaths) {
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestFile;
          return manifest.version ?? '1.2.9';
        }
      }
    } catch {
      // Ignore
    }
    return process.env.npm_package_version ?? '1.2.9';
  }

  private async getPostgresStatus(): Promise<{ status: string; role?: string; replicationLag?: number }> {
    try {
      const recovery = await this.queryOne<{ in_recovery: boolean }>(
        'SELECT pg_is_in_recovery() as in_recovery'
      );

      if (recovery?.in_recovery) {
        const lag = await this.queryOne<{ lag_bytes: string }>(
          "SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) as lag_bytes"
        );
        return {
          status: 'ok',
          role: 'replica',
          replicationLag: lag ? parseInt(lag.lag_bytes, 10) : 0,
        };
      }

      const replicas = await this.query<{ client_addr: string; state: string }>(
        'SELECT client_addr, state FROM pg_stat_replication'
      );

      return {
        status: 'ok',
        role: 'primary',
        replicationLag: replicas.length > 0 ? 0 : undefined,
      };
    } catch {
      return { status: 'ok' };
    }
  }

  private async getRedisStatus(): Promise<{ status: string; sentinelNodes?: number; master?: string }> {
    const sentinelNodes = process.env.REDIS_SENTINEL_NODES;
    const sentinelMaster = process.env.REDIS_SENTINEL_MASTER ?? 'znvault-master';

    if (!sentinelNodes) {
      if (process.env.REDIS_URL) {
        try {
          const result = await this.execAsync(
            `redis-cli -u "${process.env.REDIS_URL}" PING 2>/dev/null`,
            REDIS_PING_TIMEOUT_MS
          );
          return { status: result.trim() === 'PONG' ? 'ok' : 'error' };
        } catch {
          return { status: 'error' };
        }
      }
      return { status: 'unavailable' };
    }

    try {
      const nodes = sentinelNodes.split(',');

      const nodeResults = await Promise.allSettled(
        nodes.map(async (node) => {
          const [host, port] = node.split(':');
          const result = await this.execAsync(
            `redis-cli -h ${host} -p ${port} SENTINEL get-master-addr-by-name ${sentinelMaster} 2>/dev/null`,
            REDIS_SENTINEL_TIMEOUT_MS
          );
          return result.trim();
        })
      );

      let healthyNodes = 0;
      let masterHost = '';

      for (const result of nodeResults) {
        if (result.status === 'fulfilled' && result.value) {
          healthyNodes++;
          if (!masterHost) {
            const lines = result.value.split('\n');
            masterHost = lines[0] ?? '';
          }
        }
      }

      return {
        status: healthyNodes >= 2 ? 'ok' : (healthyNodes > 0 ? 'degraded' : 'error'),
        sentinelNodes: healthyNodes,
        master: masterHost || undefined,
      };
    } catch {
      return { status: 'error' };
    }
  }

  private async getClusterInfoFromRedis(): Promise<{ nodeCount: number; leaderNodeId: string | null }> {
    const sentinelNodes = process.env.REDIS_SENTINEL_NODES;
    const sentinelMaster = process.env.REDIS_SENTINEL_MASTER ?? 'znvault-master';

    if (!sentinelNodes) {
      return { nodeCount: 1, leaderNodeId: null };
    }

    try {
      const nodes = sentinelNodes.split(',');
      const [host, port] = nodes[0].split(':');

      const masterResult = await this.execAsync(
        `redis-cli -h ${host} -p ${port} SENTINEL get-master-addr-by-name ${sentinelMaster} 2>/dev/null`,
        3000
      );
      const masterHost = masterResult.trim().split('\n')[0];
      const masterPort = masterResult.trim().split('\n')[1] ?? '6379';

      const [nodesResult, leaderResult] = await Promise.all([
        this.execAsync(
          `redis-cli -h ${masterHost} -p ${masterPort} HGETALL 'zn-vault:nodes' 2>/dev/null`,
          3000
        ),
        this.execAsync(
          `redis-cli -h ${masterHost} -p ${masterPort} GET 'zn-vault:leader' 2>/dev/null`,
          3000
        ),
      ]);

      const lines = nodesResult.trim().split('\n').filter(l => l);
      const nodeCount = Math.max(Math.floor(lines.length / 2), 1);
      const leaderNodeId = leaderResult.trim() || null;

      return { nodeCount, leaderNodeId };
    } catch {
      return { nodeCount: 3, leaderNodeId: null };
    }
  }
}
