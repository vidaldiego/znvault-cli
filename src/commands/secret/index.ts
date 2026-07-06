// Path: src/commands/secret/index.ts

/**
 * Secret commands - main entry point
 *
 * This module provides the command registration function that combines
 * all secret subcommands into a single command group.
 */

import type { Command } from 'commander';
import { registerListCommand } from './list.js';
import { registerGetCommand } from './get.js';
import { registerDecryptCommand } from './decrypt.js';
import { registerCreateCommand } from './create.js';
import { registerUpdateCommand } from './update.js';
import { registerDeleteCommand } from './delete.js';
import { registerRotateCommand } from './rotate.js';
import { registerHistoryCommand } from './history.js';
import { registerCopyCommand } from './copy.js';
import { registerPatchCommand } from './patch.js';
import { registerCanDecryptCommand } from './can-decrypt.js';

// Help text for secret identifier format
const SECRET_ID_HELP = `
Secret Identifier Formats:
  Commands that accept <id-or-alias> support these formats:

  1. UUID:    abc12345-1234-5678-9abc-def012345678
  2. Alias:   zn-admin/config, web/api-key, smtp-credentials
  3. Prefix:  alias:zn-admin/config (optional "alias:" prefix)

  Note: Tenant is derived from your authenticated user (JWT).
  You can only access secrets within your assigned tenant.

Examples:
  znvault secret decrypt zn-admin/config
  znvault secret get web/production/api-key
  znvault secret history alias:database/credentials
  znvault secret delete abc12345-1234-5678-9abc-def012345678
`;

export function registerSecretCommands(program: Command): void {
  const secretCmd = program
    .command('secret')
    .description('Manage secrets')
    .addHelpText('after', SECRET_ID_HELP);

  // Register all subcommands
  registerListCommand(secretCmd);
  registerGetCommand(secretCmd);
  registerDecryptCommand(secretCmd);
  registerCreateCommand(secretCmd);
  registerUpdateCommand(secretCmd);
  registerDeleteCommand(secretCmd);
  registerRotateCommand(secretCmd);
  registerHistoryCommand(secretCmd);
  registerCopyCommand(secretCmd);
  registerPatchCommand(secretCmd);
  registerCanDecryptCommand(secretCmd);
}

// Re-export types for external use
export * from './types.js';
export * from './helpers.js';
export * from './resolve.js';
export * from './references.js';
