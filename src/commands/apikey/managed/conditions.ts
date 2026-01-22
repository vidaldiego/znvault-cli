// Path: src/commands/apikey/managed/conditions.ts

/**
 * Managed API key conditions update command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedConditionsOptions } from './types.js';
import type { ApiKeyConditions } from '../types.js';
import { parseConditionsFromOptions } from '../helpers.js';

export function registerManagedConditionsCommand(managedCmd: Command): void {
  managedCmd
    .command('conditions <name>')
    .description('Update managed API key ABAC conditions')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('--time-range <range>', 'Time range: "HH:MM-HH:MM [TIMEZONE]" or "clear"')
    .option('--methods <methods>', 'Comma-separated HTTP methods or "clear"')
    .option('--resources <ids>', 'Resource IDs (type:id,...) or "clear"')
    .option('--aliases <patterns>', 'Alias patterns (glob) or "clear"')
    .option('--tags <tags>', 'Resource tags (key=value,...) or "clear"')
    .option('--clear-all', 'Remove all conditions')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedConditionsOptions) => {
      let conditions: ApiKeyConditions = {};

      // Handle --clear-all
      if (!options.clearAll) {
        // Validate time range format before parsing
        if (options.timeRange && options.timeRange !== 'clear') {
          const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/.exec(options.timeRange);
          if (!match) {
            output.error('Invalid time range format. Use: "HH:MM-HH:MM [TIMEZONE]"');
            process.exit(1);
          }
        }

        conditions = parseConditionsFromOptions(options);
      }

      const spinner = ora('Updating managed API key conditions...').start();

      try {
        // First, get the managed key to find its ID
        const managedKey = await client.getManagedApiKey(name, options.tenant);

        // Update using the key ID
        const key = await client.updateApiKeyConditions(managedKey.id, conditions, options.tenant);
        spinner.succeed('Conditions updated');

        if (options.json) {
          output.json(key);
          return;
        }

        console.log(`\nManaged key: ${name}`);
        console.log('Updated conditions:');
        if (key.conditions && Object.keys(key.conditions).length > 0) {
          for (const [condKey, condValue] of Object.entries(key.conditions)) {
            console.log(`  ${condKey}: ${JSON.stringify(condValue)}`);
          }
        } else {
          console.log('  (no conditions)');
        }
      } catch (err) {
        spinner.fail('Failed to update conditions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
