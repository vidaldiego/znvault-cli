// Path: src/commands/secret/update.ts

/**
 * Secret update command
 */

import type { Command } from 'commander';

import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { UpdateOptions, DecryptedSecret, SecretMetadata } from './types.js';
import { resolveSecretId } from './resolve.js';
import {readStdinUtf8} from '../../lib/stdin.js';
import {interactiveSecretValuePromptType} from './input-policy.js';

export function registerUpdateCommand(secretCmd: Command): void {
  secretCmd
    .command('update <id-or-alias>')
    .description('Update a secret (supports UUID or tenant/alias format)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ttl <datetime>', 'TTL expiration (ISO 8601)')
    .option('--expires <datetime>', 'Natural expiration (ISO 8601)')
    .option('--json', 'Output as JSON')
    .option('--data <json>', 'New data as JSON (non-interactive)')
    .option('--data-stdin', 'Read new JSON data from stdin')
    .option('--enable-references', 'Opt this secret in to ${ref:...} reference resolution')
    .option('--no-enable-references', 'Disable reference resolution (turn opt-in off)')
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

      let metadata: SecretMetadata;
      try {
        metadata = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
      const isUserSealed = metadata.protectionMode === 'USER_SESSION_ONLY';
      if (options.data && options.dataStdin) {
        output.error('--data cannot be combined with --data-stdin');
        process.exit(1);
      }
      if (isUserSealed && options.data) {
        output.error('User-Sealed values cannot be supplied through --data; use --data-stdin or the masked interactive prompt.');
        process.exit(1);
      }

      // Check for non-interactive data option
      if (options.dataStdin) {
        try {
          const parsed: unknown = JSON.parse(await readStdinUtf8());
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('secret data must be a JSON object');
          }
          newData = parsed as Record<string, unknown>;
        } catch (error) {
          output.error(`Invalid JSON received by --data-stdin: ${(error as Error).message}`);
          process.exit(1);
        }
      } else if (options.data) {
        // Non-interactive mode: parse JSON data from CLI
        try {
          newData = JSON.parse(options.data) as Record<string, unknown>;
        } catch {
          output.error('Invalid JSON in --data option');
          process.exit(1);
        }
      } else {
        // Interactive mode: prompt for data
        const spinner = output.spinner('Fetching current secret...').start();

        try {
          // Pre-fetch the RAW template so answering "no" to the edit prompt (or
          // editing) never writes a resolved snapshot back over a reference
          // secret. Byte-identical for non-reference secrets.
          const current = await client.post<DecryptedSecret>(
            `/v1/secrets/${id}/decrypt?resolve=false`,
            {},
          );
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
                  type: interactiveSecretValuePromptType(metadata.protectionMode, 'editor'),
                  name: 'dataJson',
                  message: isUserSealed ? 'Enter replacement data (JSON):' : 'Edit data (JSON):',
                  ...(isUserSealed ? {mask: '*'} : {default: JSON.stringify(current.data, null, 2)}),
                },
              ]);
              try {
                newData = JSON.parse(dataJson) as Record<string, unknown>;
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

      const updateSpinner = output.spinner('Updating secret...').start();

      try {
        const body: Record<string, unknown> = { data: newData };
        if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        // Only send when explicitly set; omitting preserves the server's sticky opt-in.
        if (options.enableReferences !== undefined) {
          body.enableReferences = options.enableReferences;
        }

        const result = await client.put<SecretMetadata>(`/v1/secrets/${id}`, body);
        updateSpinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        output.success('Secret updated successfully!');
        console.log(`  Version: ${result.version}`);
        if (result.references) {
          console.log(`  References: ${result.references.count}`);
        }
      } catch (error) {
        updateSpinner.fail('Failed to update secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
