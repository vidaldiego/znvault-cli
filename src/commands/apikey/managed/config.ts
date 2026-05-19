// Path: src/commands/apikey/managed/config.ts

/**
 * Managed API key config update command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedConfigOptions } from './types.js';
import { apiKeyAsSuperadmin, formatDate } from '../helpers.js';

export function registerManagedConfigCommand(managedCmd: Command): void {
  managedCmd
    .command('config <name>')
    .description('Update managed key rotation configuration')
    .option('-i, --rotation-interval <interval>', 'Rotation interval (e.g., 24h, 7d)')
    .option('-g, --grace-period <period>', 'Grace period (e.g., 5m, 1h)')
    .option('--notify-before <duration>', 'Notify before rotation (e.g., 1h)')
    .option('--webhook-url <url>', 'Webhook URL for rotation notifications')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedConfigOptions, cmd: Command) => {
      const asSuperadmin = apiKeyAsSuperadmin(cmd);
      // Check if at least one config option is provided
      if (!options.rotationInterval && !options.gracePeriod && !options.notifyBefore && !options.webhookUrl) {
        output.error('At least one configuration option is required');
        output.info('Options: --rotation-interval, --grace-period, --notify-before, --webhook-url');
        process.exit(1);
      }

      const spinner = output.spinner('Updating managed API key config...').start();

      try {
        const key = await client.updateManagedApiKeyConfig(name, {
          rotationInterval: options.rotationInterval,
          gracePeriod: options.gracePeriod,
          notifyBefore: options.notifyBefore,
          webhookUrl: options.webhookUrl,
        }, options.tenant, { asSuperadmin });

        spinner.succeed('Configuration updated');

        if (options.json) {
          output.json(key);
          return;
        }

        console.log('\nUpdated configuration:');
        output.keyValue({
          'Rotation Interval': key.rotation_interval ?? '-',
          'Grace Period': key.grace_period,
          'Notify Before': key.notify_before ?? '-',
          'Webhook URL': key.webhook_url ?? '-',
          'Next Rotation': key.next_rotation_at ? formatDate(key.next_rotation_at) : '-',
        });
      } catch (err) {
        spinner.fail('Failed to update configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
