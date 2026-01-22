// Path: src/commands/secret/delete.ts

/**
 * Secret delete command
 */

import type { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DeleteOptions, SecretMetadata } from './types.js';
import { resolveSecretId } from './resolve.js';

export function registerDeleteCommand(secretCmd: Command): void {
  secretCmd
    .command('delete <id-or-alias>')
    .description('Delete a secret (supports UUID or tenant/alias format)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (idOrAlias: string, options: DeleteOptions) => {
      let id: string;

      // Resolve alias to UUID first
      try {
        id = await resolveSecretId(idOrAlias);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }

      if (!options.force) {
        // Get metadata first
        const spinner = ora('Fetching secret...').start();
        try {
          const secret = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
          spinner.stop();

          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete secret "${secret.alias}" (${id})? This cannot be undone.`,
              default: false,
            },
          ]);

          if (!confirm) {
            output.info('Deletion cancelled');
            return;
          }
        } catch (error) {
          spinner.fail('Failed to fetch secret');
          output.error((error as Error).message);
          process.exit(1);
        }
      }

      const deleteSpinner = ora('Deleting secret...').start();

      try {
        await client.delete(`/v1/secrets/${id}`);
        deleteSpinner.stop();
        output.success('Secret deleted successfully');
      } catch (error) {
        deleteSpinner.fail('Failed to delete secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
