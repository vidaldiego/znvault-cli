// Path: src/commands/dynamic-secrets.ts

/**
 * Dynamic secrets command re-exports for backward compatibility.
 * The actual implementation has been modularized into src/commands/dynamic-secrets/
 */

export { registerDynamicSecretsCommands } from './dynamic-secrets/index.js';

// Re-export types for consumers
export type {
  DbConnection,
  DbRole,
  DbLease,
  GeneratedCredential,
  TestConnectionResult,
  RenewalResult,
} from './dynamic-secrets/types.js';
