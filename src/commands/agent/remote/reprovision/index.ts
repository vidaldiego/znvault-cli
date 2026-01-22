// Path: src/commands/agent/remote/reprovision/index.ts

/**
 * Reprovision commands registration
 *
 * Commands for managing agent reprovisioning.
 */

import type { Command } from 'commander';
import { registerReprovisionCreateCommand } from './create.js';
import { registerReprovisionStatusCommand } from './status.js';
import { registerReprovisionCancelCommand } from './cancel.js';

export function registerReprovisionCommands(parentCmd: Command): void {
  const reprovisionCmd = parentCmd
    .command('reprovision')
    .description('Manage agent reprovisioning');

  registerReprovisionCreateCommand(reprovisionCmd);
  registerReprovisionStatusCommand(reprovisionCmd);
  registerReprovisionCancelCommand(reprovisionCmd);
}

/**
 * Register reprovision commands directly on a parent command (for flattening)
 */
export function registerFlattenedReprovisionCommands(parentCmd: Command): void {
  registerReprovisionCreateCommand(parentCmd);
  registerReprovisionStatusCommand(parentCmd);
  registerReprovisionCancelCommand(parentCmd);
}
