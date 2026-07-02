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
  routinesConnectionString?: string;
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
  template?: string;
  templateVersion?: string;
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

// ─── Connection Provisioner (S1) ────────────────────────────────────────────

export interface ProvisionStep {
  step: string;
  status: string;
  [key: string]: unknown;
}

export interface ProvisionReport {
  connectionId: string;
  name: string;
  steps: ProvisionStep[];
  provisioned: boolean;
}

export interface RotateAdminResult {
  rotated: boolean;
}

export interface ConnectionProvisionOptions {
  type?: string;
  rootFile?: string;
  accountPrefix?: string;
  routinesBundle?: string;
  routinesVersion?: string;
  json?: boolean;
}

// ─── Role Templates (S2) ────────────────────────────────────────────────────

/**
 * A role created from a fixed, server-defined template may return warnings
 * alongside the created role (e.g. `bundle_not_applied` for a MySQL
 * `migrate` role when the znapi-helpers routine bundle hasn't been applied
 * to the connection yet). The create still succeeds (201) in that case.
 */
export interface DbRoleCreateResponse extends DbRole {
  warnings?: string[];
}

export interface RoleTemplateSummary {
  engine: 'mysql' | 'postgresql';
  name: string;
  version: number;
  description: string;
  params: Record<string, unknown>;
}

export interface RoleTemplateDetail extends RoleTemplateSummary {
  // Rendered preview from the server (executes nothing). Matches the server's
  // ExpandedStatements shape: `{ creation, revocation, renew? }` (statement
  // arrays), NOT the `*Statements` field names used elsewhere.
  example?: {
    creation?: string[];
    revocation?: string[];
    renew?: string[];
    [key: string]: unknown;
  };
}

export interface TemplatesListOptions {
  engine?: string;
  json?: boolean;
}

export interface TemplateGetOptions {
  json?: boolean;
}
