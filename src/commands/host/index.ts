// Path: src/commands/host/index.ts
// Host management commands for unified agent deployment

import type { Command } from 'commander';
import { registerListCommand, registerStatsCommand } from './list.js';
import { registerCreateCommand } from './create.js';
import { registerGetCommand, registerOutdatedAgentsCommand } from './get.js';
import { registerConfigCommand } from './config.js';
import { registerDeleteCommand } from './delete.js';
import { registerBootstrapTokenCommand } from './bootstrap-token.js';
import { registerSyncCommand } from './sync.js';
import { registerLinkAgentCommand, registerUnlinkAgentCommand } from './link-agent.js';

/**
 * Register all host management commands
 */
export function registerHostCommands(program: Command): void {
  const hostCmd = program
    .command('host')
    .alias('hosts')
    .description('Manage host configurations for unified agent deployment');

  // List and stats
  registerListCommand(hostCmd);
  registerStatsCommand(hostCmd);

  // CRUD operations
  registerCreateCommand(hostCmd);
  registerGetCommand(hostCmd);
  registerConfigCommand(hostCmd);
  registerDeleteCommand(hostCmd);

  // Bootstrap and sync
  registerBootstrapTokenCommand(hostCmd);
  registerSyncCommand(hostCmd);

  // Agent linking
  registerLinkAgentCommand(hostCmd);
  registerUnlinkAgentCommand(hostCmd);

  // Utility commands
  registerOutdatedAgentsCommand(hostCmd);
}

// Re-export types
export * from './types.js';
