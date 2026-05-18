// Path: src/commands/apikey/index.ts

/**
 * API key commands - main entry point
 *
 * This module provides the command registration function that combines
 * all API key subcommands into a single command group.
 */

import type { Command } from 'commander';
import { registerListCommand } from './list.js';
import { registerCreateCommand } from './create.js';
import { registerShowCommand } from './show.js';
import { registerDeleteCommand } from './delete.js';
import { registerRotateCommand } from './rotate.js';
import { registerEnableDisableCommands } from './enable-disable.js';
import { registerPermissionsCommand } from './permissions.js';
import { registerConditionsCommand } from './conditions.js';
import { registerPolicyCommands } from './policies.js';
import { registerSelfCommands } from './self.js';
import { registerManagedCommands } from './managed/index.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

export function registerApiKeyCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const apiKeyCmd = parent
    .command('apikey')
    .alias('api-key')
    .description('API key management (independent, tenant-scoped)');

  withRegisterContext(ctx, () => {
    // Register all subcommands
    registerListCommand(apiKeyCmd);
    registerCreateCommand(apiKeyCmd);
    registerShowCommand(apiKeyCmd);
    registerDeleteCommand(apiKeyCmd);
    registerRotateCommand(apiKeyCmd);
    registerEnableDisableCommands(apiKeyCmd);
    registerPermissionsCommand(apiKeyCmd);
    registerConditionsCommand(apiKeyCmd);
    registerPolicyCommands(apiKeyCmd);
    // `self` / `self-rotate` are tenant-only: they introspect the currently
    // used API key, which is always tenant-scoped. Don't expose under
    // `superadmin apikey`.
    if (ctx === 'tenant') {
      registerSelfCommands(apiKeyCmd);
    }
    registerManagedCommands(apiKeyCmd);
  });
}

// Re-export types for external use
export * from './types.js';
