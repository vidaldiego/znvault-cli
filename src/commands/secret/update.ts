// Path: src/commands/secret/update.ts
import type {Command} from 'commander';
import inquirer from 'inquirer';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {readTotpConfig} from '../../lib/totp.js';
import type {UpdateOptions, DecryptedSecret, SecretMetadata} from './types.js';
import {resolveSecretId} from './resolve.js';
import {interactiveSecretValuePromptType} from './input-policy.js';
import {mergeSecretEdits, promptSecretReplacement, readSecretJsonStdin, requireEditableSecret, requireSecretObject, safeSecretError, SecretInputError} from './editing.js';

export function registerUpdateCommand(secretCmd: Command): void {
  secretCmd.command('update <id-or-alias>')
    .description('Update secret fields while preserving existing data (supports UUID or alias)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ttl <datetime>', 'TTL expiration (ISO 8601)')
    .option('--expires <datetime>', 'Natural expiration (ISO 8601)')
    .option('--json', 'Output as JSON')
    .option('--data <json>', 'JSON fields to merge (non-interactive; never use for TOTP seeds)')
    .option('--data-stdin', 'Read JSON fields to merge from stdin')
    .option('--enable-references', 'Opt this secret in to ${ref:...} reference resolution')
    .option('--no-enable-references', 'Disable reference resolution (turn opt-in off)')
    .action(async (idOrAlias: string, options: UpdateOptions) => {
      const spinner = output.spinner('Fetching current secret...').start();
      try {
        const id = await resolveSecretId(idOrAlias);
        const metadata = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
        const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt?resolve=false`, {});
        requireEditableSecret(current, true);
        if (metadata.protectionMode === 'USER_SESSION_ONLY') current.protectionMode = metadata.protectionMode;
        else current.protectionMode ??= metadata.protectionMode;
        spinner.stop();
        const isUserSealed = current.protectionMode === 'USER_SESSION_ONLY';
        if (options.data !== undefined && options.dataStdin === true) {
          throw new SecretInputError('--data cannot be combined with --data-stdin');
        }
        if (isUserSealed && options.data !== undefined) {
          throw new SecretInputError('User-Sealed values cannot be supplied through --data; use --data-stdin or the masked interactive prompt.');
        }

        let newData: Record<string, unknown> = current.data;
        if (options.dataStdin === true) {
          newData = mergeSecretEdits(current.data, await readSecretJsonStdin());
        } else if (options.data !== undefined) {
          let edits: Record<string, unknown>;
          try {
            edits = requireSecretObject(JSON.parse(options.data));
          } catch {
            throw new SecretInputError('Invalid JSON in --data option');
          }
          if (readTotpConfig(edits) !== undefined) throw new SecretInputError('TOTP seeds cannot be supplied through --data; use secret totp import with stdin or a masked prompt.');
          newData = mergeSecretEdits(current.data, edits);
        } else {
          const {updateData} = await inquirer.prompt<{updateData: boolean}>([{
            type: 'confirm', name: 'updateData', message: 'Update the secret data?', default: false,
          }]);
          if (updateData) {
            if (current.type === 'credential' && current.subType !== 'totp') {
              const answers = await inquirer.prompt<{username: string; password: string}>([
                {
                  type: interactiveSecretValuePromptType(current.protectionMode, 'input'),
                  name: 'username', message: 'Username:',
                  ...(isUserSealed ? {mask: '*'} : {default: current.data.username as string}),
                },
                {type: 'password', name: 'password', message: 'Password (leave empty to keep current):', mask: '*'},
              ]);
              newData = {...current.data, username: isUserSealed ? answers.username || current.data.username : answers.username, password: answers.password || current.data.password};
            } else newData = await promptSecretReplacement(current);
          }
        }
        const body: Record<string, unknown> = {data: newData, expectedVersion: current.version};
        if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        if (options.enableReferences !== undefined) body.enableReferences = options.enableReferences;
        const result = await client.put<SecretMetadata>(`/v1/secrets/${id}/value`, body);
        if (options.json === true) output.json(result);
        else {
          output.success('Secret updated successfully!');
          console.log(`  Version: ${result.version}`);
          if (result.references) console.log(`  References: ${result.references.count}`);
        }
      } catch (error) {
        spinner.fail('Failed to update secret');
        output.error(safeSecretError(error));
        process.exit(1);
      }
    });
}
