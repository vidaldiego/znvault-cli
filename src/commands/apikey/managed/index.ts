// Path: src/commands/apikey/managed/index.ts

/**
 * Managed API key commands registration
 */

import type { Command } from 'commander';
import { registerManagedListCommand } from './list.js';
import { registerManagedCreateCommand } from './create.js';
import { registerManagedGetCommand } from './get.js';
import { registerManagedBindCommand } from './bind.js';
import { registerManagedRotateCommand } from './rotate.js';
import { registerManagedConfigCommand } from './config.js';
import { registerManagedDeleteCommand } from './delete.js';
import { registerManagedPermissionsCommand } from './permissions.js';
import { registerManagedConditionsCommand } from './conditions.js';

export function registerManagedCommands(apiKeyCmd: Command): void {
  const managedCmd = apiKeyCmd
    .command('managed')
    .description('Managed API key operations (auto-rotating keys)');

  registerManagedListCommand(managedCmd);
  registerManagedCreateCommand(managedCmd);
  registerManagedGetCommand(managedCmd);
  registerManagedBindCommand(managedCmd);
  registerManagedRotateCommand(managedCmd);
  registerManagedConfigCommand(managedCmd);
  registerManagedDeleteCommand(managedCmd);
  registerManagedPermissionsCommand(managedCmd);
  registerManagedConditionsCommand(managedCmd);
}

// Re-export types
export * from './types.js';
