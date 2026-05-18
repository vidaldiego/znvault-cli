// Path: src/commands/sso/index.ts

/**
 * SSO/OAuth2 application management commands
 *
 * This module provides comprehensive SSO app management including:
 * - App CRUD operations (list, get, create, update, delete)
 * - Client secret rotation
 * - User access management (grant, revoke, set-role)
 */

import type { Command } from 'commander';
import { registerCrudCommands } from './crud.js';
import { registerUserCommands } from './users.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

export function registerSSOCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const sso = parent
    .command('sso')
    .description('SSO/OAuth2 application management');

  withRegisterContext(ctx, () => {
    registerCrudCommands(sso);
    registerUserCommands(sso);
  });
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export { formatTtl, buildTenantQuery } from './helpers.js';
