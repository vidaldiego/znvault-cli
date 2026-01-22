// Path: src/lib/client.ts

/**
 * Backward compatibility re-export
 *
 * This file maintains the original import path for existing code:
 *   import { client, VaultClient } from './lib/client.js';
 *
 * The implementation has been moved to src/lib/client/ for better organization.
 */

export { client, VaultClient } from './client/index.js';

// Re-export all domain clients for advanced use cases
export {
  HttpClient,
  HealthClient,
  ClusterClient,
  TenantsClient,
  UsersClient,
  SuperadminsClient,
  LockdownClient,
  AuditClient,
  ApiKeysClient,
  ManagedKeysClient,
  PoliciesClient,
  PermissionsClient,
} from './client/index.js';

// Re-export types
export type {
  RequestOptions,
  MessageResponse,
  PermissionItem,
  PermissionsResponse,
  ValidatePermissionsResponse,
  ValidatePolicyResponse,
  PolicyAttachmentsResponse,
  ClientConfig,
} from './client/index.js';
