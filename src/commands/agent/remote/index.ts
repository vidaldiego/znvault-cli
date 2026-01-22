// Path: src/commands/agent/remote/index.ts

/**
 * Remote agent commands registration
 *
 * Commands for managing agents registered with the vault.
 */

import type { Command } from 'commander';
import { registerListCommand } from './list.js';
import { registerConnectionsCommand } from './connections.js';
import { registerStatusCommand } from './status.js';
import { registerAlertsCommand } from './alerts.js';
import { registerDeleteCommand } from './delete.js';
import { registerReprovisionCommands } from './reprovision/index.js';

/**
 * Register all remote commands under a 'remote' subcommand
 */
export function registerRemoteCommands(parentCmd: Command): void {
  const remoteCmd = parentCmd
    .command('remote')
    .description('Manage agents registered with the vault');

  registerListCommand(remoteCmd);
  registerConnectionsCommand(remoteCmd);
  registerStatusCommand(remoteCmd);
  registerAlertsCommand(remoteCmd);
  registerDeleteCommand(remoteCmd);
  registerReprovisionCommands(remoteCmd);

  // Backwards compatibility aliases for old hyphenated commands
  registerBackwardsCompatCommands(remoteCmd);
}

/**
 * Register remote commands directly on a parent command (for flattening)
 */
export function registerFlattenedRemoteCommands(parentCmd: Command): void {
  registerListCommand(parentCmd);
  registerConnectionsCommand(parentCmd);
  registerStatusCommand(parentCmd);
  registerAlertsCommand(parentCmd);
  registerDeleteCommand(parentCmd);
}

/**
 * Register backwards compatibility aliases for old command names
 */
function registerBackwardsCompatCommands(remoteCmd: Command): void {
  // Old: agent remote reprovision-status <id>
  // New: agent reprovision status <id>
  remoteCmd
    .command('reprovision-status <agent-id>')
    .description('Check reprovision status (deprecated: use "agent reprovision status")')
    .option('--json', 'Output as JSON')
    .action(async (agentId: string, options: { json?: boolean }) => {
      // Import dynamically to avoid circular dependencies
      const { registerReprovisionStatusCommand } = await import('./reprovision/status.js');
      const { Command } = await import('commander');
      const tempCmd = new Command();
      registerReprovisionStatusCommand(tempCmd);
      const statusCmd = tempCmd.commands.find(c => c.name() === 'status');
      if (statusCmd) {
        await statusCmd.parseAsync([agentId, ...(options.json ? ['--json'] : [])], { from: 'user' });
      }
    })
    .hook('preAction', () => {
      console.warn('\x1b[33mWarning: "reprovision-status" is deprecated. Use "agent reprovision status" instead.\x1b[0m');
    });

  // Old: agent remote cancel-reprovision <id>
  // New: agent reprovision cancel <id>
  remoteCmd
    .command('cancel-reprovision <agent-id>')
    .description('Cancel pending reprovision (deprecated: use "agent reprovision cancel")')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: { yes?: boolean }) => {
      const { registerReprovisionCancelCommand } = await import('./reprovision/cancel.js');
      const { Command } = await import('commander');
      const tempCmd = new Command();
      registerReprovisionCancelCommand(tempCmd);
      const cancelCmd = tempCmd.commands.find(c => c.name() === 'cancel');
      if (cancelCmd) {
        await cancelCmd.parseAsync([agentId, ...(options.yes ? ['--yes'] : [])], { from: 'user' });
      }
    })
    .hook('preAction', () => {
      console.warn('\x1b[33mWarning: "cancel-reprovision" is deprecated. Use "agent reprovision cancel" instead.\x1b[0m');
    });
}

// Re-export individual command registrations for flexibility
export { registerListCommand } from './list.js';
export { registerConnectionsCommand } from './connections.js';
export { registerStatusCommand } from './status.js';
export { registerAlertsCommand } from './alerts.js';
export { registerDeleteCommand } from './delete.js';
