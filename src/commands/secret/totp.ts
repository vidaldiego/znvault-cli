import type {Command} from 'commander';
import inquirer from 'inquirer';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {readStdinUtf8} from '../../lib/stdin.js';
import {generateTotpCode, parseTotpInput, readTotpConfig, TOTP_INPUT_LIMIT_BYTES, type TotpConfig} from '../../lib/totp.js';
import type {DecryptedSecret, SecretMetadata} from './types.js';
import {resolveSecretId} from './resolve.js';
import {requireEditableSecret, safeSecretError, SecretInputError} from './editing.js';

interface ImportOptions {
  attach?: boolean;
  seedStdin?: boolean;
  protection: string;
  grantUser?: string[];
  json?: boolean;
}

async function readSeed(stdin: boolean | undefined): Promise<TotpConfig> {
  try {
    const input = stdin === true
      ? await readStdinUtf8(TOTP_INPUT_LIMIT_BYTES)
      : (await inquirer.prompt<{seedOrUri: string}>([{
        type: 'password', name: 'seedOrUri', message: 'TOTP seed or otpauth URI:', mask: '*',
      }])).seedOrUri;
    return parseTotpInput(input);
  } catch {
    throw new SecretInputError('Invalid TOTP configuration.');
  }
}

async function rawSecret(idOrAlias: string): Promise<DecryptedSecret> {
  const id = await resolveSecretId(idOrAlias);
  const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt?resolve=false`, {});
  requireEditableSecret(current);
  return current;
}

function report(result: SecretMetadata, json: boolean | undefined, message: string): void {
  if (json === true) output.json({id: result.id, alias: result.alias, version: result.version});
  else output.success(message);
}

export function registerTotpCommands(secretCmd: Command): void {
  const totp = secretCmd.command('totp').description('Import and use encrypted authenticator secrets')
    .configureOutput({outputError: (_message, write) => {write('Invalid TOTP command arguments. Use --help for supported options.\n');}});

  totp.command('import <id-or-alias>')
    .description('Import a standalone authenticator, or attach it to an existing secret')
    .option('--seed-stdin', 'Read a seed or otpauth URI from bounded stdin (otherwise use a masked prompt)')
    .option('--attach', 'Attach or replace TOTP in an existing secret; preserve its protection and grants')
    .option('--protection <mode>', 'Standalone protection: standard or user-session', 'standard')
    .option('--grant-user <userId...>', 'Explicit HUMAN user IDs for a standalone User-Sealed secret')
    .option('--json', 'Output metadata as JSON without seed material')
    .action(async (idOrAlias: string, options: ImportOptions, command: Command) => {
      try {
        if (options.attach === true) {
          if (command.getOptionValueSource('protection') === 'cli' || options.grantUser !== undefined) {
            throw new SecretInputError('Protection and grants cannot be changed while attaching TOTP.');
          }
          const current = await rawSecret(idOrAlias);
          if (['rsa_public_key', 'ed25519_public_key', 'ecdsa_public_key'].includes(current.subType ?? '')) {
            throw new SecretInputError('Authenticators cannot be attached to public-key secrets.');
          }
          if (Object.hasOwn(current.data, 'totp') && readTotpConfig(current.data) === undefined) {
            throw new SecretInputError('The existing totp field is not a canonical authenticator; resolve the legacy field before importing.');
          }
          const config = await readSeed(options.seedStdin);
          const result = await client.put<SecretMetadata>(`/v1/secrets/${current.id}/value`, {
            data: {...current.data, totp: config}, expectedVersion: current.version,
          });
          report(result, options.json, 'Authenticator attached successfully!');
          return;
        }
        if (options.protection !== 'standard' && options.protection !== 'user-session') {
          throw new SecretInputError('--protection must be standard or user-session');
        }
        if (options.protection === 'standard' && options.grantUser !== undefined) {
          throw new SecretInputError('--grant-user requires --protection user-session');
        }
        const config = await readSeed(options.seedStdin);
        const result = await client.post<SecretMetadata>('/v1/secrets', {
          alias: idOrAlias, type: 'credential', subType: 'totp', data: {totp: config},
          ...(options.protection === 'user-session' ? {
            protectionMode: 'USER_SESSION_ONLY',
            ...(options.grantUser === undefined ? {} : {grantUserIds: options.grantUser}),
          } : {}),
        });
        report(result, options.json, 'Authenticator imported successfully!');
      } catch (error) {
        output.error(safeSecretError(error));
        process.exit(1);
      }
    });

  totp.command('code <id-or-alias>')
    .description('Print only the current code after normal authorised decryption')
    .option('--json', 'Output code, validUntil (Unix milliseconds) and period')
    .action(async (idOrAlias: string, options: {json?: boolean}) => {
      try {
        const id = await resolveSecretId(idOrAlias);
        const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
        const config = readTotpConfig(current.data);
        if (config === undefined) throw new SecretInputError('This secret has no canonical authenticator.');
        const code = generateTotpCode(config);
        if (options.json === true) output.json(code);
        else console.log(code.code);
      } catch (error) {
        output.error(safeSecretError(error));
        process.exit(1);
      }
    });

  totp.command('remove <id-or-alias>')
    .description('Remove an attached authenticator (old versions remain in normal secret history)')
    .option('--json', 'Output metadata as JSON')
    .action(async (idOrAlias: string, options: {json?: boolean}) => {
      try {
        const current = await rawSecret(idOrAlias);
        if (current.subType === 'totp') throw new SecretInputError('Use secret delete to delete a standalone authenticator.');
        if (readTotpConfig(current.data) === undefined) throw new SecretInputError('This secret has no canonical authenticator.');
        const data = {...current.data};
        delete data.totp;
        const result = await client.put<SecretMetadata>(`/v1/secrets/${current.id}/value`, {data, expectedVersion: current.version});
        report(result, options.json, 'Authenticator removed successfully!');
      } catch (error) {
        output.error(safeSecretError(error));
        process.exit(1);
      }
    });
}
