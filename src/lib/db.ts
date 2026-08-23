// Path: src/lib/db.ts

/**
 * Database client re-exports for backward compatibility.
 * The actual implementation has been modularized into src/lib/db/
 */

export {
  LocalDBClient,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- compat shim: this file exists to keep old import paths working, including the deprecated alias
  EmergencyDBClient,
  isEmergencyDbAvailable,
  isLocalDbAvailable,
} from './db/index.js';

// Re-export types for consumers that import directly from db.ts
export type {
  TenantRow,
  UserRow,
  HANodeRow,
  LockdownRow,
  LockdownHistoryRow,
  ThreatEventRow,
  AuditLogRow,
  ManifestFile,
  DBClientBase,
} from './db/types.js';
