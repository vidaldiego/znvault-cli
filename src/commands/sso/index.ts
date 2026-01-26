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

export function registerSSOCommands(program: Command): void {
  const sso = program
    .command('sso')
    .description('SSO/OAuth2 application management');

  // Register all sub-command groups
  registerCrudCommands(sso);
  registerUserCommands(sso);
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export { formatTtl, buildTenantQuery } from './helpers.js';
