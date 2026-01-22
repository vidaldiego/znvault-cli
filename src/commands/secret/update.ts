// Path: src/commands/secret/update.ts

/**
 * Secret update command
 */

import type { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { UpdateOptions, DecryptedSecret, SecretMetadata } from './types.js';
import { resolveSecretId } from './resolve.js';

export function registerUpdateCommand(secretCmd: Command): void {
  secretCmd
    .command('update <id-or-alias>')
    .description('Update a secret (supports UUID or tenant/alias format)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ttl <datetime>', 'TTL expiration (ISO 8601)')
    .option('--expires <datetime>', 'Natural expiration (ISO 8601)')
    .option('--json', 'Output as JSON')
    .option('--data <json>', 'New data as JSON (non-interactive)')
    .action(async (idOrAlias: string, options: UpdateOptions) => {
      let newData: Record<string, unknown> | undefined;
      let id: string;

      // Resolve alias to UUID first
      try {
        id = await resolveSecretId(idOrAlias);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }

      // Check for non-interactive data option
      if (options.data) {
        // Non-interactive mode: parse JSON data from CLI
        try {
          newData = JSON.parse(options.data);
        } catch {
          output.error('Invalid JSON in --data option');
          process.exit(1);
        }
      } else {
        // Interactive mode: prompt for data
        const spinner = ora('Fetching current secret...').start();

        try {
          const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
          spinner.stop();

          const { updateData } = await inquirer.prompt<{ updateData: boolean }>([
            {
              type: 'confirm',
              name: 'updateData',
              message: 'Update the secret data?',
              default: false,
            },
          ]);

          newData = current.data;

          if (updateData) {
            if (current.type === 'credential') {
              const answers = await inquirer.prompt<{ username: string; password: string }>([
                {
                  type: 'input',
                  name: 'username',
                  message: 'Username:',
                  default: current.data.username as string
                },
                {
                  type: 'password',
                  name: 'password',
                  message: 'Password (leave empty to keep current):',
                  mask: '*'
                },
              ]);
              newData = {
                username: answers.username,
                password: answers.password || current.data.password,
              };
            } else {
              const { dataJson } = await inquirer.prompt<{ dataJson: string }>([
                {
                  type: 'editor',
                  name: 'dataJson',
                  message: 'Edit data (JSON):',
                  default: JSON.stringify(current.data, null, 2),
                },
              ]);
              try {
                newData = JSON.parse(dataJson);
              } catch {
                output.error('Invalid JSON data');
                process.exit(1);
              }
            }
          }
        } catch (error) {
          spinner.fail('Failed to fetch current secret');
          output.error((error as Error).message);
          process.exit(1);
        }
      }

      const updateSpinner = ora('Updating secret...').start();

      try {
        const body: Record<string, unknown> = { data: newData };
        if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;

        const result = await client.put<SecretMetadata>(`/v1/secrets/${id}`, body);
        updateSpinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        output.success('Secret updated successfully!');
        console.log(`  Version: ${result.version}`);
      } catch (error) {
        updateSpinner.fail('Failed to update secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
