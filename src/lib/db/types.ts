// Path: src/lib/db/types.ts

/**
 * Internal types for database operations
 */

import type pg from 'pg';

export interface ManifestFile {
  version?: string;
}

export interface DBClientBase {
  client: pg.Client;
  connected: boolean;
  connect(): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

// Row types for database queries

export interface TenantRow {
  id: string;
  name: string;
  status: string;
  max_secrets: number | null;
  max_kms_keys: number | null;
  contact_email: string | null;
  created_at: Date;
  updated_at: Date;
  secrets_count?: string;
  kms_keys_count?: string;
  users_count?: string;
  api_keys_count?: string;
}

export interface UserRow {
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
}

export interface HANodeRow {
  node_id: string;
  advertised_host: string;
  advertised_port: number;
  is_leader: boolean;
  last_heartbeat: Date;
  status: string;
}

export interface LockdownRow {
  scope: string;
  tenant_id: string | null;
  status: string;
  reason: string | null;
  triggered_at: Date | null;
  triggered_by: string | null;
  escalation_count: number;
}

export interface LockdownHistoryRow {
  id: string;
  previous_status: string;
  new_status: string;
  transition_reason: string;
  changed_by_user_id: string | null;
  changed_by_system: boolean;
  created_at: Date;
}

export interface ThreatEventRow {
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
}

export interface AuditLogRow {
  id: number;
  timestamp: Date;
  client_cn: string | null;
  tenant_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  status_code: number;
  ip_address: string | null;
}
