// Path: src/commands/apikey/conditions.ts

/**
 * API key conditions update command
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { UpdateConditionsOptions, ApiKeyConditions } from './types.js';
import { displayConditions, parseConditionsFromOptions } from './helpers.js';

export function registerConditionsCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('update-conditions <id>')
    .description('Update API key inline ABAC conditions')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('--time-range <range>', 'Time range: "HH:MM-HH:MM [TIMEZONE]" or "clear"')
    .option('--methods <methods>', 'Comma-separated HTTP methods or "clear"')
    .option('--resources <ids>', 'Resource IDs (type:id,...) or "clear"')
    .option('--aliases <patterns>', 'Alias patterns (glob) or "clear"')
    .option('--tags <tags>', 'Resource tags (key=value,...) or "clear"')
    .option('--clear-all', 'Remove all conditions')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdateConditionsOptions) => {
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

      const spinner = output.spinner('Updating conditions...').start();

      try {
        const key = await client.updateApiKeyConditions(id, conditions, options.tenant);
        spinner.succeed('Conditions updated');

        if (options.json) {
          output.json(key);
          return;
        }

        const keyConditions = key.conditions as ApiKeyConditions | undefined;
        if (keyConditions && Object.keys(keyConditions).length > 0) {
          console.log('\nUpdated conditions:');
          displayConditions(keyConditions);
        } else {
          console.log('\nAll conditions cleared.');
        }
      } catch (err) {
        spinner.fail('Failed to update conditions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
