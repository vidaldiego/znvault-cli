// Path: src/commands/apikey/permissions.ts

/**
 * API key permissions update command
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { UpdatePermissionsOptions } from './types.js';

export function registerPermissionsCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('update-permissions <id>')
    .description('Update API key permissions')
    .option('-s, --set <perms>', 'Set permissions (comma-separated, replaces all)')
    .option('-a, --add <perms>', 'Add permissions (comma-separated)')
    .option('-r, --remove <perms>', 'Remove permissions (comma-separated)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdatePermissionsOptions) => {
      if (!options.set && !options.add && !options.remove) {
        output.error('At least one of --set, --add, or --remove is required');
        output.info('Examples:');
        output.info('  znvault apikey update-permissions <id> --set "secret:read,secret:list"');
        output.info('  znvault apikey update-permissions <id> --add "kms:encrypt"');
        output.info('  znvault apikey update-permissions <id> --remove "secret:delete"');
        process.exit(1);
      }

      const spinner = output.spinner('Updating permissions...').start();

      try {
        let newPermissions: string[];

        if (options.set) {
          // Replace all permissions
          newPermissions = options.set.split(',').map((p) => p.trim());
        } else {
          // Need to get current permissions first
          const currentKey = await client.getApiKey(id, options.tenant);
          newPermissions = [...currentKey.permissions];

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

        const key = await client.updateApiKeyPermissions(id, newPermissions, options.tenant);
        spinner.succeed('Permissions updated');

        if (options.json) {
          output.json(key);
          return;
        }

        console.log('\nUpdated permissions:');
        for (const perm of key.permissions) {
          console.log(`  - ${perm}`);
        }
      } catch (err) {
        spinner.fail('Failed to update permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
