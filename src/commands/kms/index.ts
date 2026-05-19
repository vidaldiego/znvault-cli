// Path: src/commands/kms/index.ts

/**
 * KMS (Key Management Service) commands
 *
 * This module provides comprehensive KMS management including:
 * - Key CRUD operations (list, get, create, delete)
 * - Cryptographic operations (encrypt, decrypt, generate-data-key)
 * - Key lifecycle management (rotate, enable, disable, versions)
 */

import type { Command } from 'commander';
import { registerCrudCommands } from './crud.js';
import { registerCryptoCommands } from './crypto.js';
import { registerLifecycleCommands } from './lifecycle.js';
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
    // KMS crypto ops have no superadmin counterpart by design (separation
    // of duties), so they are not threaded with the asSuperadmin flag.
    registerCryptoCommands(kms);
    registerLifecycleCommands(kms, asSuperadmin);
  });
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export { formatDate, formatKeyState, parseContext, truncateId } from './helpers.js';
