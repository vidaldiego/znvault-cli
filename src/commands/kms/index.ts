// Path: src/commands/kms/index.ts

/**
 * KMS (Key Management Service) commands
 *
 * This module provides comprehensive KMS management including:
 * - Key CRUD operations (list, get, create, delete)
 * - Cryptographic operations (encrypt, decrypt, generate-data-key)
 * - Key lifecycle management (rotate, enable, disable, versions)
 * - Per-key authorization (policy put/list, grant create/list/retire/revoke)
 */

import type { Command } from 'commander';
import { registerCrudCommands } from './crud.js';
import { registerCryptoCommands } from './crypto.js';
import { registerLifecycleCommands } from './lifecycle.js';
import { registerPolicyCommands } from './policy.js';
import { registerPrehashCommands } from './prehash.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

export function registerKmsCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const asSuperadmin = ctx === 'superadmin';
  const kms = parent
    .command('kms')
    .description('KMS (Key Management Service) operations');

  // Register all sub-command groups under the active context (controls whether
  // `--tenant` options are accepted; see command-context.applyTenantContextPatch).
  withRegisterContext(ctx, () => {
    registerCrudCommands(kms, asSuperadmin);
    // KMS crypto ops + policies/grants have no superadmin counterpart by
    // design (separation of duties — see src/routes/admin/kms-keys.ts in the
    // server repo). They MUST NOT appear under `znvault superadmin kms ...`
    // or they would 404 against /v1/superadmin/kms/keys/.../policy. So we
    // omit them from the superadmin tree entirely.
    if (!asSuperadmin) {
      registerCryptoCommands(kms);
      registerPolicyCommands(kms);
      // Prehash arming is a tenant-only op (server rejects superadmin), like
      // crypto ops and policies — no /v1/superadmin/* counterpart.
      registerPrehashCommands(kms);
    }
    registerLifecycleCommands(kms, asSuperadmin);
  });
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export { formatDate, formatKeyState, parseContext, truncateId } from './helpers.js';
