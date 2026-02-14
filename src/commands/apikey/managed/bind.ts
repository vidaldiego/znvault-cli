// Path: src/commands/apikey/managed/bind.ts

/**
 * Managed API key bind command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedBindOptions } from './types.js';
import { formatRotationMode, formatTimeUntil } from './helpers.js';
import { formatDate } from '../helpers.js';

export function registerManagedBindCommand(managedCmd: Command): void {
  managedCmd
    .command('bind <name>')
    .description('Bind to a managed key and get the current key value')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedBindOptions) => {
      const spinner = output.spinner('Binding to managed API key...').start();

      try {
        const result = await client.bindManagedApiKey(name, options.tenant);
        spinner.succeed('Bound to managed API key');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n────────────────────────────────────────────────────────────────');
        console.log(`API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'Name': result.name,
          'Key ID': result.id,
          'Prefix': result.prefix,
          'Rotation Mode': formatRotationMode(result.rotationMode),
          'Next Rotation': result.nextRotationAt ? `${formatDate(result.nextRotationAt)} (${formatTimeUntil(result.nextRotationAt)})` : '-',
          'Grace Period': result.gracePeriod,
          'Grace Expires': result.graceExpiresAt ? formatDate(result.graceExpiresAt) : '-',
          'Key Expires': formatDate(result.expiresAt),
        });

        if (result.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        if (result._notice) {
          console.log(`\n⚠️  ${result._notice}`);
        }
      } catch (err) {
        spinner.fail('Failed to bind to managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
