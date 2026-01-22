// Path: src/commands/apikey/managed/get.ts

/**
 * Managed API key get/show command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedGetOptions } from './types.js';
import { displayManagedKeyDetails } from './helpers.js';

export function registerManagedGetCommand(managedCmd: Command): void {
  managedCmd
    .command('get <name>')
    .alias('show')
    .description('Show managed API key details')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedGetOptions) => {
      const spinner = ora('Fetching managed API key...').start();

      try {
        const key = await client.getManagedApiKey(name, options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(key);
          return;
        }

        displayManagedKeyDetails(key);
      } catch (err) {
        spinner.fail('Failed to fetch managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
