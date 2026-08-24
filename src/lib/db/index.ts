// Path: src/lib/db/index.ts

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types --
   Delegating facade: every member is `x = (...) => this.sub.x(...)`, so its return type IS the
   sub-client's and is inferred from it. Re-declaring it here would duplicate ~80 signatures that
   could silently drift from the ones they wrap. Non-facade code in this file still needs types. */

/**
 * Modular database client for direct PostgreSQL operations.
 * Used for local mode (running on vault nodes) and emergency operations.
 */

import { getLocalConfig } from '../local.js';
import { HealthOperations } from './health.js';
import { TenantOperations } from './tenants.js';
import { UserOperations } from './users.js';
import { LockdownOperations } from './lockdown.js';
import { AuditOperations } from './audit.js';
import { EmergencyOperations } from './emergency.js';
import { LmkEscrowOperations } from './lmk-escrow.js';
import type { LmkEscrowDatabaseSnapshot, RootKeyEnvelopeRow } from './lmk-escrow.js';
import { PreflightOperations } from './preflight.js';
import type { PreflightDatabaseSnapshot } from './preflight.js';

// Re-export types
export * from './types.js';
export type { RootKeyEnvelopeRow } from './lmk-escrow.js';
export type { PreflightDatabaseSnapshot } from './preflight.js';
export { PreflightOperations } from './preflight.js';
export type {
  LmkEscrowActiveRotation,
  LmkEscrowAuditHead,
  LmkEscrowBackupBinding,
  LmkEscrowDatabaseSnapshot,
  LmkEscrowVersionRow,
} from './lmk-escrow.js';

/**
 * Composite database client that combines all operation modules.
 * Uses composition pattern to delegate to specialized operation classes.
 */
export class LocalDBClient {
  private healthOps: HealthOperations;
  private tenantOps: TenantOperations;
  private userOps: UserOperations;
  private lockdownOps: LockdownOperations;
  private auditOps: AuditOperations;
  private emergencyOps: EmergencyOperations;
  private lmkEscrowOps: LmkEscrowOperations;
  private preflightOps: PreflightOperations;

  constructor() {
    // All operations share the same connection strategy via BaseDBClient
    this.healthOps = new HealthOperations();
    this.tenantOps = new TenantOperations();
    this.userOps = new UserOperations();
    this.lockdownOps = new LockdownOperations();
    this.auditOps = new AuditOperations();
    this.emergencyOps = new EmergencyOperations();
    this.lmkEscrowOps = new LmkEscrowOperations();
    this.preflightOps = new PreflightOperations();
  }

  // Connection management - delegate to health ops (or any op, they all have the same base)
  async connect(): Promise<void> {
    await this.healthOps.connect();
  }

  async close(): Promise<void> {
    // Close all connections
    await Promise.all([
      this.healthOps.close(),
      this.tenantOps.close(),
      this.userOps.close(),
      this.lockdownOps.close(),
      this.auditOps.close(),
      this.emergencyOps.close(),
      this.lmkEscrowOps.close(),
      this.preflightOps.close(),
    ]);
  }

  async disconnect(): Promise<void> {
    return this.close();
  }

  // ============ Health ============
  health = () => this.healthOps.health();
  clusterStatus = () => this.healthOps.clusterStatus();

  // ============ Tenants ============
  listTenants = (options?: Parameters<TenantOperations['listTenants']>[0]) =>
    this.tenantOps.listTenants(options);
  getTenant = (id: string, withUsage?: boolean) =>
    this.tenantOps.getTenant(id, withUsage);
  getTenantUsage = (id: string) =>
    this.tenantOps.getTenantUsage(id);

  // ============ Users ============
  listUsers = (options?: Parameters<UserOperations['listUsers']>[0]) =>
    this.userOps.listUsers(options);
  getUser = (id: string) =>
    this.userOps.getUser(id);
  getUserByUsername = (username: string) =>
    this.userOps.getUserByUsername(username);
  listSuperadmins = () =>
    this.userOps.listSuperadmins();

  // ============ Lockdown ============
  getLockdownStatus = () =>
    this.lockdownOps.getLockdownStatus();
  getLockdownHistory = (limit?: number) =>
    this.lockdownOps.getLockdownHistory(limit);
  getThreats = (options?: Parameters<LockdownOperations['getThreats']>[0]) =>
    this.lockdownOps.getThreats(options);

  // ============ Audit ============
  listAudit = (options?: Parameters<AuditOperations['listAudit']>[0]) =>
    this.auditOps.listAudit(options);
  verifyAuditChain = () =>
    this.auditOps.verifyAuditChain();

  // ============ Emergency Operations ============
  testConnection = () =>
    this.emergencyOps.testConnection();
  getUserStatus = (username: string) =>
    this.emergencyOps.getUserStatus(username);
  resetPassword = (username: string, newPassword: string) =>
    this.emergencyOps.resetPassword(username, newPassword);
  unlockUser = (username: string) =>
    this.emergencyOps.unlockUser(username);
  disableTotp = (username: string) =>
    this.emergencyOps.disableTotp(username);

  // ============ Local LMK Escrow (read-only DB capture) ============
  captureLmkEscrow = (backupId?: string): Promise<LmkEscrowDatabaseSnapshot> =>
    this.lmkEscrowOps.capture(backupId);

  getRootKeyEnvelope = (providerId: string): Promise<RootKeyEnvelopeRow | null> =>
    this.lmkEscrowOps.getRootKeyEnvelope(providerId);

  listRootKeyEnvelopeProviders = (): Promise<string[]> =>
    this.lmkEscrowOps.listRootKeyEnvelopeProviders();

  // ============ BSK rotation preflight (read-only DB capture) ============
  capturePreflight = (): Promise<PreflightDatabaseSnapshot> =>
    this.preflightOps.capture();
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
