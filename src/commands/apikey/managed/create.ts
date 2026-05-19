// Path: src/commands/apikey/managed/create.ts

/**
 * Managed API key create command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { RotationMode } from '../../../types/index.js';
import type { ManagedCreateOptions } from './types.js';
import { displayManagedKeyDetails } from './helpers.js';
import { apiKeyAsSuperadmin } from '../helpers.js';

export function registerManagedCreateCommand(managedCmd: Command): void {
  managedCmd
    .command('create <name>')
    .description('Create a new managed API key with auto-rotation')
    .option('-e, --expires <days>', 'Days until expiration (1-3650, default: 365)', '365')
    .option('-p, --permissions <perms>', 'Comma-separated permissions (required)')
    .option('-d, --description <desc>', 'Description')
    .option('-m, --rotation-mode <mode>', 'Rotation mode: scheduled, on-use, on-bind (required)')
    .option('-i, --rotation-interval <interval>', 'Rotation interval (e.g., 24h, 7d) - required for scheduled mode')
    .option('-g, --grace-period <period>', 'Grace period (e.g., 5m, 1h)', '5m')
    .option('--notify-before <duration>', 'Notify before rotation (e.g., 1h)')
    .option('--webhook-url <url>', 'Webhook URL for rotation notifications')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedCreateOptions, cmd: Command) => {
      const asSuperadmin = apiKeyAsSuperadmin(cmd);
      // Validate required options
      if (!options.permissions) {
        output.error('--permissions is required. Use comma-separated permission strings.');
        process.exit(1);
      }

      if (!options.rotationMode) {
        output.error('--rotation-mode is required. Use: scheduled, on-use, or on-bind');
        process.exit(1);
      }

      const rotationMode = options.rotationMode as RotationMode;
      if (!['scheduled', 'on-use', 'on-bind'].includes(rotationMode)) {
        output.error('Invalid rotation mode. Use: scheduled, on-use, or on-bind');
        process.exit(1);
      }

      if (rotationMode === 'scheduled' && !options.rotationInterval) {
        output.error('--rotation-interval is required for scheduled rotation mode');
        output.info('Example: --rotation-interval 24h');
        process.exit(1);
      }

      const permissions = options.permissions.split(',').map((p) => p.trim());
      const spinner = output.spinner('Creating managed API key...').start();

      try {
        const expiresInDays = parseInt(options.expires, 10);
        if (isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          spinner.fail('Invalid expiration');
          output.error('Expiration must be between 1 and 3650 days');
          process.exit(1);
        }

        const result = await client.createManagedApiKey({
          name,
          description: options.description,
          expiresInDays,
          permissions,
          tenantId: options.tenant,
          asSuperadmin,
          ipAllowlist: options.ip?.split(',').map((ip) => ip.trim()),
          managed: {
            rotationMode,
            rotationInterval: options.rotationInterval,
            gracePeriod: options.gracePeriod,
            notifyBefore: options.notifyBefore,
            webhookUrl: options.webhookUrl,
          },
        });

        spinner.succeed('Managed API key created');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n✓ Managed API key created successfully');
        console.log('\nNote: Managed keys do not show the key value at creation.');
        console.log('Use "znvault apikey managed bind <name>" to get the current key value.\n');

        displayManagedKeyDetails(result.apiKey);
      } catch (err) {
        spinner.fail('Failed to create managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
