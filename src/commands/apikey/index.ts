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

export function registerApiKeyCommands(program: Command): void {
  const apiKeyCmd = program
    .command('apikey')
    .alias('api-key')
    .description('API key management (independent, tenant-scoped)');

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
  registerSelfCommands(apiKeyCmd);
  registerManagedCommands(apiKeyCmd);
}

// Re-export types for external use
export * from './types.js';
