import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {promptConfirm} from '../../lib/prompts.js';

export function registerGrantCommands(secretCmd: Command): void {
  secretCmd.command('recover <secretId>')
    .description('Decrypt through enabled tenant-root recovery')
    .option('--json', 'Output as JSON')
    .action(async (secretId: string, options: { json?: boolean }) => {
      try {
        const result = await client.post<{ data: unknown }>(
          `/v1/secrets/${encodeURIComponent(secretId)}/root-recover`,
          {},
        );
        if (options.json) {
          output.json(result);
          return;
        }
        output.json(result.data);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  secretCmd.command('recovery')
    .description('Show or change tenant root recovery for future User-Sealed Secrets')
    .option('--enable', 'Enable root recovery')
    .option('--disable', 'Disable root recovery and remove existing recovery envelopes')
    .option('-y, --yes', 'Confirm removal of recovery envelopes')
    .option('--json', 'Output as JSON')
    .action(async (options: { enable?: boolean; disable?: boolean; yes?: boolean; json?: boolean }) => {
      try {
        if (options.enable && options.disable) throw new Error('Choose either --enable or --disable');
        if (options.disable && !options.yes) {
          const confirmed = await promptConfirm(
            'Disable tenant-root recovery and permanently remove its existing recovery envelopes?',
            false,
          );
          if (!confirmed) {
            output.info('Cancelled.');
            return;
          }
        }
        const result = options.enable || options.disable
          ? await client.put<{ enabled: boolean }>('/v1/tenant/user-sealed-settings', {
              rootRecoveryEnabled: options.enable === true,
            })
          : await client.get<{ enabled: boolean }>('/v1/tenant/user-sealed-settings');
        if (options.json) {
          output.json(result);
          return;
        }
        output.info(`Tenant root recovery: ${result.enabled ? 'enabled' : 'disabled'}`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  secretCmd.command('grants <secretId>')
    .description('List users assigned to a User-Sealed Secret')
    .option('--json', 'Output as JSON')
    .action(async (secretId: string, options: { json?: boolean }) => {
      try {
        const result = await client.get<{
          items: Array<{ userId: string; username: string; createdAt: string; status: 'CURRENT' | 'STALE' | 'INACTIVE' }>;
          rootRecoveryAvailable: boolean;
          isTenantRoot: boolean;
        }>(
          `/v1/secrets/${encodeURIComponent(secretId)}/user-grants`,
        );
        if (options.json) {
          output.json(result);
          return;
        }
        if (result.items.length === 0) {
          output.info('No users are assigned.');
          return;
        }
        output.table(
          ['User', 'User ID', 'Grant status', 'Granted'],
          result.items.map((grant) => [grant.username, grant.userId, grant.status, grant.createdAt]),
        );
        output.info(`Tenant-root recovery for this secret: ${result.rootRecoveryAvailable ? 'available' : 'unavailable'}`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  secretCmd.command('grant <secretId>')
    .description('Assign a user to a User-Sealed Secret')
    .requiredOption('--user <userId>', 'User ID to assign')
    .action(async (secretId: string, options: { user: string }) => {
      try {
        await client.post(`/v1/secrets/${encodeURIComponent(secretId)}/user-grants`, { userId: options.user });
        output.success(`User ${options.user} assigned.`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  secretCmd.command('recover-grant <secretId>')
    .description('Explicitly recover as tenant root and reissue a user grant')
    .requiredOption('--user <userId>', 'User ID to assign')
    .action(async (secretId: string, options: { user: string }) => {
      try {
        await client.post(
          `/v1/secrets/${encodeURIComponent(secretId)}/root-recover/user-grants`,
          {userId: options.user},
        );
        output.success(`User ${options.user} assigned through audited tenant-root recovery.`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  secretCmd.command('revoke <secretId>')
    .description('Remove a user from a User-Sealed Secret')
    .requiredOption('--user <userId>', 'User ID to remove')
    .action(async (secretId: string, options: { user: string }) => {
      try {
        await client.delete(`/v1/secrets/${encodeURIComponent(secretId)}/user-grants/${encodeURIComponent(options.user)}`);
        output.success(`User ${options.user} removed.`);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
