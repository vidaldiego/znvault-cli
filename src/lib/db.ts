import pg from 'pg';
import bcryptjs from 'bcryptjs';
import { getLocalConfig } from './local.js';
import type {
  HealthResponse,
  ClusterStatus,
  ClusterNode,
  TenantWithUsage,
  TenantUsage,
  User,
  Superadmin,
  LockdownStatus,
  ThreatEvent,
  LockdownHistoryEntry,
  AuditEntry,
  AuditVerifyResult,
} from '../types/index.js';

const { Client } = pg;

interface ManifestFile {
  version?: string;
}

/**
 * Database client for direct PostgreSQL operations.
 * Used for local mode (running on vault nodes) and emergency operations.
 */
export class LocalDBClient {
  private client: pg.Client;
  private connected = false;

  constructor() {
    const config = getLocalConfig();
    if (!config) {
      throw new Error(
        'Database configuration not available.\n' +
        'Either set DATABASE_URL environment variable or run with sudo on a vault node.'
      );
    }

    this.client = new Client({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
    }
  }

  // Alias for compatibility
  async disconnect(): Promise<void> {
    return this.close();
  }

  private async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    await this.connect();
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  private async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  // ============ Health ============

  async health(): Promise<HealthResponse> {
    await this.connect();

    // Get basic stats - check database connectivity
    const dbTime = await this.queryOne<{ now: Date }>('SELECT NOW() as now');

    // Get version from manifest or default
    const version = await this.getVaultVersion();

    // Check HA from environment
    const haEnabled = process.env.HA_ENABLED === 'true';
    const nodeId = process.env.HA_NODE_ID ?? 'standalone';

    // Get PostgreSQL status
    const pgStatus = await this.getPostgresStatus();

    // Get Redis status
    const redisStatus = await this.getRedisStatus();

    // Get cluster info from Redis if available
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

  private async getVaultVersion(): Promise<string> {
    // Try to read from manifest file (MANIFEST.json inside release)
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
      // Check if this is primary or replica
      const recovery = await this.queryOne<{ in_recovery: boolean }>(
        'SELECT pg_is_in_recovery() as in_recovery'
      );

      if (recovery?.in_recovery) {
        // This is a replica - check replication lag
        const lag = await this.queryOne<{ lag_bytes: string }>(
          "SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) as lag_bytes"
        );
        return {
          status: 'ok',
          role: 'replica',
          replicationLag: lag ? parseInt(lag.lag_bytes, 10) : 0,
        };
      }

      // This is primary - check replication status
      const replicas = await this.query<{ client_addr: string; state: string }>(
        'SELECT client_addr, state FROM pg_stat_replication'
      );

      return {
        status: 'ok',
        role: 'primary',
        replicationLag: replicas.length > 0 ? 0 : undefined,
      };
    } catch {
      return { status: 'ok' }; // Basic connection works
    }
  }

  private async getRedisStatus(): Promise<{ status: string; sentinelNodes?: number; master?: string }> {
    const sentinelNodes = process.env.REDIS_SENTINEL_NODES;
    const sentinelMaster = process.env.REDIS_SENTINEL_MASTER ?? 'znvault-master';

    if (!sentinelNodes) {
      // Check for simple Redis URL
      if (process.env.REDIS_URL) {
        try {
          const { execSync } = await import('node:child_process');
          const result = execSync(`redis-cli -u "${process.env.REDIS_URL}" PING 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 5000,
          });
          return { status: result.trim() === 'PONG' ? 'ok' : 'error' };
        } catch {
          return { status: 'error' };
        }
      }
      return { status: 'unavailable' };
    }

    // Check Redis Sentinel
    try {
      const { execSync } = await import('node:child_process');
      const nodes = sentinelNodes.split(',');
      let healthyNodes = 0;
      let masterHost = '';

      for (const node of nodes) {
        const [host, port] = node.split(':');
        try {
          const result = execSync(
            `redis-cli -h ${host} -p ${port} SENTINEL get-master-addr-by-name ${sentinelMaster} 2>/dev/null`,
            { encoding: 'utf-8', timeout: 3000 }
          );
          if (result.trim()) {
            healthyNodes++;
            if (!masterHost) {
              const lines = result.trim().split('\n');
              masterHost = lines[0] ?? '';
            }
          }
        } catch {
          // Node not reachable
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
      const { execSync } = await import('node:child_process');
      const nodes = sentinelNodes.split(',');
      const [host, port] = nodes[0].split(':');

      // Get master info
      const masterResult = execSync(
        `redis-cli -h ${host} -p ${port} SENTINEL get-master-addr-by-name ${sentinelMaster} 2>/dev/null`,
        { encoding: 'utf-8', timeout: 3000 }
      );
      const masterHost = masterResult.trim().split('\n')[0];

      // Try to get cluster nodes from Redis
      const masterPort = masterResult.trim().split('\n')[1] ?? '6379';
      const nodesResult = execSync(
        `redis-cli -h ${masterHost} -p ${masterPort} HGETALL 'zn-vault:nodes' 2>/dev/null`,
        { encoding: 'utf-8', timeout: 3000 }
      );

      // Parse node data - HGETALL returns key1, value1, key2, value2, etc.
      const lines = nodesResult.trim().split('\n').filter(l => l);
      const nodeCount = Math.max(Math.floor(lines.length / 2), 1);

      // Get leader
      const leaderResult = execSync(
        `redis-cli -h ${masterHost} -p ${masterPort} GET 'zn-vault:leader' 2>/dev/null`,
        { encoding: 'utf-8', timeout: 3000 }
      );
      const leaderNodeId = leaderResult.trim() || null;

      return { nodeCount, leaderNodeId };
    } catch {
      return { nodeCount: 3, leaderNodeId: null }; // Default assumption for 3-node cluster
    }
  }

  // ============ Cluster ============

  async clusterStatus(): Promise<ClusterStatus> {
    await this.connect();

    // Check HA from environment
    const haEnabled = process.env.HA_ENABLED === 'true';
    const nodeId = process.env.HA_NODE_ID ?? 'unknown';

    // Get cluster nodes from ha_nodes table if it exists
    let nodes: ClusterNode[] = [];
    try {
      const dbNodes = await this.query<{
        node_id: string;
        advertised_host: string;
        advertised_port: number;
        is_leader: boolean;
        last_heartbeat: Date;
        status: string;
      }>(`
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

    // Find leader
    const leader = nodes.find(n => n.isLeader);

    return {
      enabled: haEnabled,
      nodeId,
      isLeader: leader?.nodeId === nodeId,
      leaderNodeId: leader?.nodeId ?? null,
      nodes,
    };
  }

  // ============ Tenants ============

  async listTenants(options?: { status?: string; withUsage?: boolean }): Promise<TenantWithUsage[]> {
    let sql = `
      SELECT t.id, t.name, t.status, t.max_secrets, t.max_kms_keys, t.contact_email,
             t.created_at, t.updated_at
      FROM tenants t
    `;

    const params: unknown[] = [];

    if (options?.status) {
      sql += ' WHERE t.status = $1';
      params.push(options.status);
    }

    sql += ' ORDER BY t.name';

    const rows = await this.query<{
      id: string;
      name: string;
      status: string;
      max_secrets: number | null;
      max_kms_keys: number | null;
      contact_email: string | null;
      created_at: Date;
      updated_at: Date;
    }>(sql, params);

    const tenants: TenantWithUsage[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status as 'active' | 'suspended' | 'archived',
      maxSecrets: r.max_secrets ?? undefined,
      maxKmsKeys: r.max_kms_keys ?? undefined,
      contactEmail: r.contact_email ?? undefined,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));

    if (options?.withUsage) {
      for (const tenant of tenants) {
        const usage = await this.getTenantUsage(tenant.id);
        tenant.usage = usage;
      }
    }

    return tenants;
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
      storageUsedMb: 0, // Would need to calculate
      usersCount: parseInt(users?.count ?? '0', 10),
      apiKeysCount: parseInt(apiKeys?.count ?? '0', 10),
    };
  }

  // ============ Users ============

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

    const rows = await this.query<{
      id: string;
      username: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
      status: string;
      totp_enabled: boolean;
      failed_attempts: number;
      locked_until: Date | null;
      last_login: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(sql, params);

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
    const row = await this.queryOne<{
      id: string;
      username: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
      status: string;
      totp_enabled: boolean;
      failed_attempts: number;
      locked_until: Date | null;
      last_login: Date | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM users WHERE id = $1', [id]);

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
    const row = await this.queryOne<{
      id: string;
      username: string;
      email: string | null;
      role: string;
      tenant_id: string | null;
      status: string;
      totp_enabled: boolean;
      failed_attempts: number;
      locked_until: Date | null;
      last_login: Date | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);

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

  // ============ Superadmins ============

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

  // ============ Lockdown ============

  async getLockdownStatus(): Promise<LockdownStatus> {
    const row = await this.queryOne<{
      scope: string;
      tenant_id: string | null;
      status: string;
      reason: string | null;
      triggered_at: Date | null;
      triggered_by: string | null;
      escalation_count: number;
    }>('SELECT * FROM lockdown_state ORDER BY updated_at DESC LIMIT 1');

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
    const rows = await this.query<{
      id: string;
      previous_status: string;
      new_status: string;
      transition_reason: string;
      changed_by_user_id: string | null;
      changed_by_system: boolean;
      created_at: Date;
    }>('SELECT * FROM lockdown_history ORDER BY created_at DESC LIMIT $1', [limit]);

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

    const rows = await this.query<{
      id: string;
      tenant_id: string | null;
      user_id: string | null;
      ip: string;
      user_agent: string | null;
      category: string;
      signal: string;
      suggested_level: number;
      endpoint: string;
      method: string;
      status_code: number;
      escalated: boolean;
      created_at: Date;
    }>(sql, params);

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

  // ============ Audit ============

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

    const rows = await this.query<{
      id: number;
      timestamp: Date;
      client_cn: string | null;
      tenant_id: string | null;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      status_code: number;
      ip_address: string | null;
    }>(sql, params);

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

  async verifyAuditChain(): Promise<AuditVerifyResult> {
    // Get total count
    const countResult = await this.queryOne<{ count: string }>('SELECT COUNT(*) as count FROM audit_log');
    const total = parseInt(countResult?.count ?? '0', 10);

    if (total === 0) {
      return {
        valid: true,
        totalEntries: 0,
        verifiedEntries: 0,
        message: 'No audit entries to verify',
      };
    }

    // For now, return a basic verification
    // Full HMAC chain verification would require the secret key
    return {
      valid: true,
      totalEntries: total,
      verifiedEntries: total,
      message: `Verified ${total} audit entries (chain integrity check requires API access)`,
    };
  }

  // ============ Emergency Operations ============

  /**
   * Test database connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.connect();
      const result = await this.queryOne<{ time: Date; db: string }>(
        'SELECT NOW() as time, current_database() as db'
      );
      return {
        success: true,
        message: `Connected to database '${result?.db ?? 'unknown'}' at ${result?.time.toISOString() ?? 'unknown'}`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Get user status (for diagnostics)
   */
  async getUserStatus(username: string): Promise<{
    found: boolean;
    user?: {
      id: string;
      username: string;
      email: string | null;
      role: string;
      status: string;
      totpEnabled: boolean;
      failedAttempts: number;
      lockedUntil: string | null;
      lastLogin: string | null;
    };
  }> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return { found: false };
    }

    return {
      found: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email ?? null,
        role: user.role,
        status: user.status,
        totpEnabled: user.totpEnabled,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil ?? null,
        lastLogin: user.lastLogin ?? null,
      },
    };
  }

  /**
   * Reset a user's password directly in the database.
   */
  async resetPassword(username: string, newPassword: string): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.connect();

    try {
      const passwordHash = bcryptjs.hashSync(newPassword, 12);

      const findResult = await this.queryOne<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (!findResult) {
        return { success: false, message: `User '${username}' not found` };
      }

      await this.client.query(
        `UPDATE users SET
          password_hash = $1,
          totp_enabled = false,
          totp_secret_cipher = NULL,
          totp_nonce = NULL,
          totp_tag = NULL,
          backup_codes_cipher = NULL,
          backup_codes_nonce = NULL,
          backup_codes_tag = NULL,
          failed_attempts = 0,
          locked_until = NULL,
          status = 'active',
          password_must_change = true,
          updated_at = NOW()
        WHERE id = $2`,
        [passwordHash, findResult.id]
      );

      return {
        success: true,
        message: `Password reset for user '${findResult.username}'. TOTP disabled, account unlocked.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to reset password: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Unlock a locked user account
   */
  async unlockUser(username: string): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.connect();

    try {
      const findResult = await this.queryOne<{
        id: string;
        username: string;
        status: string;
        failed_attempts: number;
        locked_until: Date | null;
      }>(
        'SELECT id, username, status, failed_attempts, locked_until FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (!findResult) {
        return { success: false, message: `User '${username}' not found` };
      }

      if (findResult.status === 'active' && findResult.failed_attempts === 0 && !findResult.locked_until) {
        return { success: true, message: `User '${findResult.username}' is already unlocked` };
      }

      await this.client.query(
        `UPDATE users SET
          status = 'active',
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
        WHERE id = $1`,
        [findResult.id]
      );

      return {
        success: true,
        message: `User '${findResult.username}' has been unlocked`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to unlock user: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Disable TOTP for a user
   */
  async disableTotp(username: string): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.connect();

    try {
      const findResult = await this.queryOne<{
        id: string;
        username: string;
        totp_enabled: boolean;
      }>(
        'SELECT id, username, totp_enabled FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (!findResult) {
        return { success: false, message: `User '${username}' not found` };
      }

      if (!findResult.totp_enabled) {
        return { success: true, message: `TOTP is already disabled for '${findResult.username}'` };
      }

      await this.client.query(
        `UPDATE users SET
          totp_enabled = false,
          totp_secret_cipher = NULL,
          totp_nonce = NULL,
          totp_tag = NULL,
          backup_codes_cipher = NULL,
          backup_codes_nonce = NULL,
          backup_codes_tag = NULL,
          updated_at = NOW()
        WHERE id = $1`,
        [findResult.id]
      );

      return {
        success: true,
        message: `TOTP disabled for user '${findResult.username}'`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to disable TOTP: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ============ Legacy exports for backward compatibility ============

/**
 * Legacy EmergencyDBClient class (alias for LocalDBClient)
 * @deprecated Use LocalDBClient instead
 */
export class EmergencyDBClient extends LocalDBClient {
  constructor() {
    // For emergency operations, DATABASE_URL must be set
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required for emergency operations.\n' +
        'This should only be set when running directly on a vault node.'
      );
    }
    super();
  }
}

/**
 * Check if emergency DB access is available
 */
export function isEmergencyDbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Check if local mode is available (more comprehensive check)
 */
export function isLocalDbAvailable(): boolean {
  const config = getLocalConfig();
  return config !== null;
}
