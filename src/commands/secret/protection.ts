import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {promptConfirm} from '../../lib/prompts.js';
import {resolveSecretId} from './resolve.js';

interface ProtectionOptions {
  protection: string;
  history: string;
  grantUser?: string[];
  rootRecovery?: boolean;
  yes?: boolean;
  json?: boolean;
}

interface ConversionResult {
  id: string;
  previousMode: 'STANDARD' | 'USER_SESSION_ONLY';
  protectionMode: 'STANDARD' | 'USER_SESSION_ONLY';
  historyMode: 'PRESERVE_HISTORY' | 'DELETE_HISTORY';
  versionsConverted: number;
  historyVersionsDeleted: number;
  grantCount: number;
  rootRecoveryWrapped: boolean;
}

export function registerProtectionCommand(secretCmd: Command): void {
  secretCmd.command('protection <id-or-alias>')
    .description('Cryptographically convert a secret between Standard and User-Sealed')
    .requiredOption('--protection <mode>', 'Target protection: standard or user-session')
    .option('--history <mode>', 'History handling: preserve or delete', 'preserve')
    .option('--grant-user <userId...>', 'Human user IDs to grant when sealing')
    .option('--root-recovery', 'Use tenant-root recovery to unseal when no direct grant is available')
    .option('-y, --yes', 'Accept required destructive and access-widening confirmations')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  znvault secret protection app/credential --protection user-session --grant-user USER_ID
  znvault secret protection app/credential --protection standard
  znvault secret protection app/credential --protection user-session --history delete --yes --grant-user USER_ID

The default is --history preserve, which re-encrypts every retained version.
--history delete removes retained history irreversibly. Database backups and WAL
may still contain older encrypted records until their own retention expires.
`)
    .action(async (idOrAlias: string, options: ProtectionOptions) => {
      try {
        if (options.protection !== 'standard' && options.protection !== 'user-session') {
          throw new Error('--protection must be standard or user-session');
        }
        if (options.history !== 'preserve' && options.history !== 'delete') {
          throw new Error('--history must be preserve or delete');
        }
        if (options.protection === 'standard' && (options.grantUser?.length ?? 0) > 0) {
          throw new Error('--grant-user is only valid with --protection user-session');
        }
        if (options.protection === 'user-session' && options.rootRecovery === true) {
          throw new Error('--root-recovery is only valid with --protection standard');
        }

        if (options.history === 'delete' && !options.yes) {
          const confirmed = await promptConfirm(
            'Permanently delete every retained version before converting this secret?',
            false,
          );
          if (!confirmed) {
            output.info('Cancelled. No changes were made.');
            return;
          }
        }
        if (options.protection === 'standard' && !options.yes) {
          const confirmed = await promptConfirm(
            'Convert to Standard and allow API keys/service accounts to decrypt when normal permissions permit?',
            false,
          );
          if (!confirmed) {
            output.info('Cancelled. No changes were made.');
            return;
          }
        }

        const secretId = await resolveSecretId(idOrAlias);
        const targetMode = options.protection === 'user-session'
          ? 'USER_SESSION_ONLY'
          : 'STANDARD';
        const historyMode = options.history === 'delete'
          ? 'DELETE_HISTORY'
          : 'PRESERVE_HISTORY';
        const result = await client.post<ConversionResult>(
          `/v1/secrets/${encodeURIComponent(secretId)}/protection-mode`,
          {
            targetMode,
            historyMode,
            ...(options.grantUser !== undefined ? {grantUserIds: options.grantUser} : {}),
            ...(historyMode === 'DELETE_HISTORY' ? {confirmHistoryDeletion: true} : {}),
            ...(targetMode === 'STANDARD' ? {confirmStandardExposure: true} : {}),
            ...(options.rootRecovery === true ? {useRootRecovery: true} : {}),
          },
        );

        if (options.json) {
          output.json(result);
          return;
        }
        output.success(`Secret protection converted to ${result.protectionMode === 'USER_SESSION_ONLY' ? 'User-Sealed' : 'Standard'}.`);
        output.info(`Versions re-encrypted: ${result.versionsConverted}`);
        if (result.historyVersionsDeleted > 0) {
          output.warn(`Historical versions deleted: ${result.historyVersionsDeleted}`);
        }
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
