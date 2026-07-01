// Path: src/commands/dynamic-secrets/types.ts

/**
 * Type definitions for dynamic secrets commands
 */

export interface DbConnection {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  connectionType: 'POSTGRESQL' | 'MYSQL';
  maxOpenConnections: number;
  connectionTimeoutSeconds: number;
  status: 'ACTIVE' | 'DISABLED' | 'FAILED' | 'TESTING';
  lastHealthCheck: string | null;
  lastHealthCheckStatus: boolean | null;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  roleCount?: number;
  activeLeases?: number;
}

export interface DbRole {
  id: string;
  tenantId: string;
  connectionId: string;
  connectionName?: string;
  name: string;
  description: string | null;
  defaultTtlSeconds: number | null;
  maxTtlSeconds: number | null;
  usernameTemplate: string;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  activeLeases?: number;
}

export interface DbLease {
  id: string;
  tenantId: string;
  connectionId: string;
  connectionName?: string;
  roleId: string;
  roleName?: string;
  username: string;
  issuedAt: string;
  expiresAt: string;
  lastRenewedAt: string | null;
  renewalCount: number;
  maxExpiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'FAILED';
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  ttlRemaining: number;
}

export interface GeneratedCredential {
  leaseId: string;
  username: string;
  password: string;
  expiresAt: string;
  maxExpiresAt: string;
  ttlSeconds: number;
  renewalCount: number;
  host?: string;
  port?: number;
  database?: string;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
}

export interface RenewalResult {
  leaseId: string;
  expiresAt: string;
  renewalCount: number;
  ttlSeconds: number;
}

// Command option interfaces
export interface ConnectionCreateOptions {
  name?: string;
  type?: string;
  connectionString?: string;
  description?: string;
  maxConnections?: string;
  timeout?: string;
  defaultTtl?: string;
  maxTtl?: string;
  json?: boolean;
}

export interface ConnectionUpdateOptions {
  description?: string;
  maxConnections?: string;
  timeout?: string;
  defaultTtl?: string;
  maxTtl?: string;
  status?: string;
  json?: boolean;
}

export interface RoleCreateOptions {
  name?: string;
  description?: string;
  creationStatements?: string;
  revocationStatements?: string;
  renewStatements?: string;
  defaultTtl?: string;
  maxTtl?: string;
  usernameTemplate?: string;
  json?: boolean;
}

export interface RoleUpdateOptions {
  description?: string;
  creationStatements?: string;
  revocationStatements?: string;
  renewStatements?: string;
  defaultTtl?: string;
  maxTtl?: string;
  enabled?: string;
  json?: boolean;
}

export interface LeaseListOptions {
  role?: string;
  status?: string;
  json?: boolean;
}

export interface LeaseRevokeOptions {
  reason?: string;
  force?: boolean;
  json?: boolean;
}
