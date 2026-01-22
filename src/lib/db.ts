// Path: src/lib/db.ts

/**
 * Database client re-exports for backward compatibility.
 * The actual implementation has been modularized into src/lib/db/
 */

export {
  LocalDBClient,
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
