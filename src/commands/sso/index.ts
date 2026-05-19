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
  const asSuperadmin = ctx === 'superadmin';
  const sso = parent
    .command('sso')
    .description('SSO/OAuth2 application management');

  withRegisterContext(ctx, () => {
    // Crud read paths route to `/v1/superadmin/sso/apps` in admin context;
    // write paths and `users` subcommands do not have admin equivalents
    // and will surface the "must use /v1/superadmin/*" error if invoked
    // by a superadmin (correct: those ops are unsupported cross-tenant).
    registerCrudCommands(sso, asSuperadmin);
    registerUserCommands(sso);
  });
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export { formatTtl, buildTenantQuery } from './helpers.js';
