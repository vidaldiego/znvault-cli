// Path: src/commands/apikey/managed/rotate.ts

/**
 * Managed API key rotate command
 */

import type { Command } from 'commander';

import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedRotateOptions } from './types.js';
import { formatDate } from '../helpers.js';

export function registerManagedRotateCommand(managedCmd: Command): void {
  managedCmd
    .command('rotate <name>')
    .description('Force immediate rotation of a managed key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .action(async (name: string, options: ManagedRotateOptions) => {
      const spinner = output.spinner('Rotating managed API key...').start();

      try {
        const result = await client.rotateManagedApiKey(name, options.tenant);
        spinner.succeed('Managed API key rotated');

        console.log(`\n${result.message}`);
        if (result.nextRotationAt) {
          console.log(`Next scheduled rotation: ${formatDate(result.nextRotationAt)}`);
        }
        console.log('\nUse "znvault apikey managed bind <name>" to get the new key value.');
      } catch (err) {
        spinner.fail('Failed to rotate managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
