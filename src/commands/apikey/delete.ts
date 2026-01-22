// Path: src/commands/apikey/delete.ts

/**
 * API key delete command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DeleteOptions } from './types.js';

export function registerDeleteCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      if (!options.force) {
        output.warn(`This will permanently delete API key: ${id}`);
        output.warn('The key will stop working immediately.');
      }

      const spinner = ora('Deleting API key...').start();

      try {
        await client.deleteApiKey(id, options.tenant);
        spinner.succeed(`API key deleted: ${id}`);
      } catch (err) {
        spinner.fail('Failed to delete API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
