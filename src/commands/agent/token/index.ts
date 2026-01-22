// Path: src/commands/agent/token/index.ts

/**
 * Token commands registration
 *
 * Manage registration tokens for agent bootstrapping.
 */

import type { Command } from 'commander';
import { registerTokenCreateCommand } from './create.js';
import { registerTokenListCommand } from './list.js';
import { registerTokenRevokeCommand } from './revoke.js';

export function registerTokenCommands(parentCmd: Command): void {
  const tokenCmd = parentCmd
    .command('token')
    .description('Manage registration tokens for agent bootstrapping');

  registerTokenCreateCommand(tokenCmd);
  registerTokenListCommand(tokenCmd);
  registerTokenRevokeCommand(tokenCmd);
}
