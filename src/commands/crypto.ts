// Path: znvault-cli/src/commands/crypto.ts

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';

interface CryptoStatusResponse {
  mode: 'all' | 'none' | 'root-delegated';
  otpUnsealRequired: boolean;
  unsealTimeoutMinutes: number;
  tenantRootUserId: string | null;
  tenantRootUsername: string;
  activeGrantsCount: number;
  isTenantRoot: boolean;
  hasCryptoGrant: boolean;
}

interface CryptoGrantResponse {
  id: string;
  adminUserId: string;
  adminUsername: string;
  grantedByUserId: string;
  grantedByUsername: string;
  grantedAt: string;
  isActive: boolean;
}

interface CryptoGrantsListResponse {
  grants: CryptoGrantResponse[];
  count: number;
}

interface CryptoStatusOptions {
  json?: boolean;
}

interface CryptoListOptions {
  json?: boolean;
}

interface CryptoGrantOptions {
  json?: boolean;
}

interface CryptoRevokeOptions {
  force?: boolean;
  json?: boolean;
}

interface TransferRootOptions {
  force?: boolean;
  json?: boolean;
}

export function registerCryptoCommands(program: Command): void {
  const cryptoCmd = program
    .command('crypto')
    .description('Manage admin crypto access (root-delegated mode)');

  // Status command
  cryptoCmd
    .command('status')
    .description('Show crypto mode status')
    .option('--json', 'Output as JSON')
    .action(async (options: CryptoStatusOptions) => {
      const spinner = ora('Loading crypto status...').start();

      try {
        const status = await client.get<CryptoStatusResponse>('/v1/admin-crypto/status');
        spinner.stop();

        if (options.json) {
          output.json(status);
          return;
        }

        const modeLabels: Record<string, string> = {
          'all': 'All Admins',
          'none': 'Disabled',
          'root-delegated': 'Root Delegated',
        };

        const statusData: Record<string, { value: string; status?: 'success' | 'warning' | 'error' | 'info' }> = {
          'Crypto Mode': {
            value: modeLabels[status.mode] ?? status.mode,
            status: status.mode === 'none' ? 'warning' : 'info'
          },
          'OTP Unseal Required': {
            value: status.otpUnsealRequired ? 'Yes' : 'No',
            status: status.otpUnsealRequired ? 'success' : 'warning'
          },
          'Unseal Timeout': { value: `${status.unsealTimeoutMinutes} minutes` },
        };

        if (status.mode === 'root-delegated') {
          statusData['Tenant Root'] = { value: status.tenantRootUsername };
          statusData['Active Grants'] = { value: String(status.activeGrantsCount) };
        }

        statusData['Your Status'] = {
          value: status.isTenantRoot
            ? 'Tenant Root'
            : status.hasCryptoGrant
              ? 'Granted'
              : 'No Access',
          status: status.isTenantRoot || status.hasCryptoGrant ? 'success' : 'warning'
        };

        console.log();
        console.log(visual.statusBox('CRYPTO ACCESS STATUS', statusData));
        console.log();
      } catch (err) {
        spinner.fail('Failed to load crypto status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // List grants
  cryptoCmd
    .command('list')
    .description('List crypto access grants')
    .option('--json', 'Output as JSON')
    .action(async (options: CryptoListOptions) => {
      const spinner = ora('Loading grants...').start();

      try {
        const result = await client.get<CryptoGrantsListResponse>('/v1/admin-crypto/grants');
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.grants.length === 0) {
          console.log();
          output.info('No active crypto grants found.');
          console.log();
          return;
        }

        console.log();
        console.log(visual.sectionHeader(`CRYPTO GRANTS (${result.count})`));
        console.log();

        for (const grant of result.grants) {
          const statusIcon = grant.isActive ? chalk.green('●') : chalk.red('●');

          console.log(`${statusIcon} ${chalk.bold(grant.adminUsername)}`);
          console.log(`  User ID: ${grant.adminUserId}`);
          console.log(`  Granted by: ${grant.grantedByUsername}`);
          console.log(`  Granted at: ${output.formatDate(grant.grantedAt)}`);
          console.log();
        }
      } catch (err) {
        spinner.fail('Failed to list grants');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Grant crypto access
  cryptoCmd
    .command('grant <username>')
    .description('Grant crypto access to an admin user (tenant root only)')
    .option('--json', 'Output as JSON')
    .action(async (username: string, options: CryptoGrantOptions) => {
      const spinner = ora(`Granting crypto access to ${username}...`).start();

      try {
        const result = await client.post<{ granted: boolean; grant: CryptoGrantResponse }>(
          '/v1/admin-crypto/grant',
          { username }
        );

        spinner.succeed(`Crypto access granted to ${username}`);

        if (options.json) {
          output.json(result);
        } else {
          output.success(`${username} can now access crypto operations after unsealing.`);
        }
      } catch (err) {
        spinner.fail('Failed to grant crypto access');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Revoke crypto access
  cryptoCmd
    .command('revoke <username>')
    .description('Revoke crypto access from an admin user (tenant root only)')
    .option('-f, --force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (username: string, options: CryptoRevokeOptions) => {
      // Confirm unless --force
      if (!options.force) {
        const confirmed = await promptConfirm(`Revoke crypto access from ${username}?`, false);
        if (!confirmed) {
          output.info('Revocation cancelled');
          return;
        }
      }

      const spinner = ora(`Revoking crypto access from ${username}...`).start();

      try {
        const result = await client.post<{ revoked: boolean }>('/v1/admin-crypto/revoke', {
          username
        });

        spinner.succeed(`Crypto access revoked from ${username}`);

        if (options.json) {
          output.json(result);
        } else {
          output.success(`${username} can no longer access crypto operations.`);
        }
      } catch (err) {
        spinner.fail('Failed to revoke crypto access');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Transfer root
  cryptoCmd
    .command('transfer-root <username>')
    .description('Transfer tenant root role to another admin')
    .option('-f, --force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (username: string, options: TransferRootOptions) => {
      // Confirm unless --force
      if (!options.force) {
        console.log();
        output.warn('This will transfer the tenant root role to another user.');
        output.warn('You will lose the ability to manage crypto grants.');
        console.log();

        const confirmed = await promptConfirm(`Transfer tenant root to ${username}?`, false);
        if (!confirmed) {
          output.info('Transfer cancelled');
          return;
        }
      }

      const spinner = ora(`Transferring tenant root to ${username}...`).start();

      try {
        const result = await client.post<{
          transferred: boolean;
          newRootUserId: string;
          newRootUsername: string;
        }>('/v1/admin-crypto/transfer-root', { username });

        spinner.succeed(`Tenant root transferred to ${username}`);

        if (options.json) {
          output.json(result);
        } else {
          output.success(`${username} is now the tenant root.`);
          output.info('You are no longer the tenant root.');
        }
      } catch (err) {
        spinner.fail('Failed to transfer tenant root');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
