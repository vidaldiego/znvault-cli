// Path: src/commands/apikey/managed/delete.ts

/**
 * Managed API key delete command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedDeleteOptions } from './types.js';

export function registerManagedDeleteCommand(managedCmd: Command): void {
  managedCmd
    .command('delete <name>')
    .alias('rm')
    .description('Delete a managed API key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, options: ManagedDeleteOptions) => {
      if (!options.force) {
        output.warn(`This will permanently delete managed API key: ${name}`);
        output.warn('All bound applications will lose access immediately.');
      }

      const spinner = output.spinner('Deleting managed API key...').start();

      try {
        await client.deleteManagedApiKey(name, options.tenant);
        spinner.succeed(`Managed API key deleted: ${name}`);
      } catch (err) {
        spinner.fail('Failed to delete managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
