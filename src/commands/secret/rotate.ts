// Path: src/commands/secret/rotate.ts
import type {Command} from 'commander';
import inquirer from 'inquirer';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {RotateOptions, DecryptedSecret, SecretMetadata} from './types.js';
import {resolveSecretId} from './resolve.js';
import {mergeSecretEdits, promptSecretReplacement, readSecretJsonStdin, requireEditableSecret, safeSecretError} from './editing.js';

export function registerRotateCommand(secretCmd: Command): void {
  secretCmd.command('rotate <id-or-alias>')
    .description('Rotate secret fields while preserving existing data (supports UUID or alias)')
    .option('--json', 'Output as JSON')
    .option('--data-stdin', 'Read replacement JSON fields from stdin')
    .action(async (idOrAlias: string, options: RotateOptions) => {
      const spinner = output.spinner('Fetching current secret...').start();
      try {
        const id = await resolveSecretId(idOrAlias);
        const metadata = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
        const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt?resolve=false`, {});
        requireEditableSecret(current, true);
        if (metadata.protectionMode === 'USER_SESSION_ONLY') current.protectionMode = metadata.protectionMode;
        else current.protectionMode ??= metadata.protectionMode;
        spinner.stop();
        if (options.json !== true) console.log(`Current secret: ${current.alias} (v${current.version})`);

        let newData: Record<string, unknown>;
        if (options.dataStdin === true) newData = mergeSecretEdits(current.data, await readSecretJsonStdin());
        else if (current.type === 'credential' && current.subType !== 'totp') {
          const answers = await inquirer.prompt<{password: string}>([{
            type: 'password', name: 'password', message: 'New password:', mask: '*',
            validate: (input: string) => input.length > 0 || 'Password is required',
          }]);
          newData = {...current.data, password: answers.password};
        } else newData = await promptSecretReplacement(current);

        const result = await client.post<SecretMetadata>(`/v1/secrets/${id}/rotate/value`, {data: newData, expectedVersion: current.version});
        if (options.json === true) output.json(result);
        else {
          output.success('Secret rotated successfully!');
          console.log(`  New Version: ${result.version}`);
        }
      } catch (error) {
        spinner.fail('Failed to rotate secret');
        output.error(safeSecretError(error));
        process.exit(1);
      }
    });
}
