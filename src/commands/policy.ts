// Path: src/commands/policy.ts

/**
 * Policy command re-exports for backward compatibility.
 * The actual implementation has been modularized into src/commands/policy/
 */

export { registerPolicyCommands } from './policy/index.js';

// Re-export types for consumers
export type {
  PolicyListOptions,
  PolicyGetOptions,
  PolicyCreateOptions,
  PolicyUpdateOptions,
  PolicyDeleteOptions,
  PolicyToggleOptions,
  PolicyAttachOptions,
  PolicyValidateOptions,
  PolicyAttachmentsOptions,
  PolicyUserPoliciesOptions,
  PolicyRolePoliciesOptions,
  PolicyTestOptions,
  PolicyExportOptions,
  PolicyImportOptions,
} from './policy/types.js';
