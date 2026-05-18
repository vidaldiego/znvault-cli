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
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

/**
 * Register all host management commands
 */
export function registerHostCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const hostCmd = parent
    .command('host')
    .alias('hosts')
    .description('Manage host configurations for unified agent deployment');

  withRegisterContext(ctx, () => {
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
  });
}

// Re-export types
export * from './types.js';
