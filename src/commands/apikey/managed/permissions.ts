// Path: src/commands/apikey/managed/permissions.ts

/**
 * Managed API key permissions update command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedPermissionsOptions } from './types.js';

export function registerManagedPermissionsCommand(managedCmd: Command): void {
  managedCmd
    .command('permissions <name>')
    .description('Update managed API key permissions')
    .option('-s, --set <perms>', 'Set permissions (comma-separated, replaces all)')
    .option('-a, --add <perms>', 'Add permissions (comma-separated)')
    .option('-r, --remove <perms>', 'Remove permissions (comma-separated)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedPermissionsOptions) => {
      if (!options.set && !options.add && !options.remove) {
        output.error('At least one of --set, --add, or --remove is required');
        output.info('Examples:');
        output.info('  znvault apikey managed permissions my-key --set "secret:read,secret:list"');
        output.info('  znvault apikey managed permissions my-key --add "kms:encrypt"');
        output.info('  znvault apikey managed permissions my-key --remove "secret:delete"');
        process.exit(1);
      }

      const spinner = output.spinner('Updating managed API key permissions...').start();

      try {
        // First, get the managed key to find its ID and current permissions
        const managedKey = await client.getManagedApiKey(name, options.tenant);

        let newPermissions: string[];

        if (options.set) {
          // Replace all permissions
          newPermissions = options.set.split(',').map((p) => p.trim());
        } else {
          // Start with current permissions
          newPermissions = [...managedKey.permissions];

          if (options.add) {
            const toAdd = options.add.split(',').map((p) => p.trim());
            for (const perm of toAdd) {
              if (!newPermissions.includes(perm)) {
                newPermissions.push(perm);
              }
            }
          }

          if (options.remove) {
            const toRemove = options.remove.split(',').map((p) => p.trim());
            newPermissions = newPermissions.filter((p) => !toRemove.includes(p));
          }
        }

        if (newPermissions.length === 0) {
          spinner.fail('Cannot remove all permissions');
          output.error('API key must have at least one permission');
          process.exit(1);
        }

        // Update using the key ID
        const updatedKey = await client.updateApiKeyPermissions(managedKey.id, newPermissions, options.tenant);

        spinner.succeed('Permissions updated');

        if (options.json) {
          output.json(updatedKey);
          return;
        }

        console.log(`\nManaged key: ${name}`);
        console.log('Updated permissions:');
        for (const perm of updatedKey.permissions) {
          console.log(`  - ${perm}`);
        }
      } catch (err) {
        spinner.fail('Failed to update permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
