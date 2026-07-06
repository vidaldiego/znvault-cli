// Path: src/commands/secret/rotate.ts

/**
 * Secret rotate command
 */

import type { Command } from 'commander';

import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { RotateOptions, DecryptedSecret, SecretMetadata } from './types.js';
import { resolveSecretId } from './resolve.js';

export function registerRotateCommand(secretCmd: Command): void {
  secretCmd
    .command('rotate <id-or-alias>')
    .description('Rotate secret (supports UUID or tenant/alias format)')
    .option('--json', 'Output as JSON')
    .action(async (idOrAlias: string, options: RotateOptions) => {
      const spinner = output.spinner('Resolving secret...').start();

      try {
        // Resolve alias to UUID if needed
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Fetching current secret...';

        // Pre-fetch the RAW template so rotating a reference secret never bakes a
        // resolved snapshot into the new version. Byte-identical for others.
        const current = await client.post<DecryptedSecret>(
          `/v1/secrets/${id}/decrypt?resolve=false`,
          {},
        );
        spinner.stop();

        console.log(`Current secret: ${current.alias} (v${current.version})`);

        // Prompt for new data
        let newData: Record<string, unknown>;

        if (current.type === 'credential') {
          const answers = await inquirer.prompt<{ password: string }>([
            {
              type: 'password',
              name: 'password',
              message: 'New password:',
              mask: '*',
              validate: (input: string) => input.length > 0 || 'Password is required',
            },
          ]);
          newData = {
            username: current.data.username,
            password: answers.password,
          };
        } else {
          const { dataJson } = await inquirer.prompt<{ dataJson: string }>([
            {
              type: 'editor',
              name: 'dataJson',
              message: 'Enter new data (JSON):',
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

        const rotateSpinner = output.spinner('Rotating secret...').start();

        const result = await client.post<SecretMetadata>(`/v1/secrets/${id}/rotate`, { data: newData });
        rotateSpinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        output.success('Secret rotated successfully!');
        console.log(`  New Version: ${result.version}`);
      } catch (error) {
        spinner.fail('Failed to rotate secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
