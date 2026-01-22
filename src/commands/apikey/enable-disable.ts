// Path: src/commands/apikey/enable-disable.ts

/**
 * API key enable/disable commands
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { EnableDisableOptions } from './types.js';

export function registerEnableDisableCommands(apiKeyCmd: Command): void {
  // Enable API key
  apiKeyCmd
    .command('enable <id>')
    .description('Enable an API key (allow authentication)')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (id: string, options: EnableDisableOptions) => {
      const spinner = ora('Enabling API key...').start();

      try {
        const key = await client.setApiKeyEnabled(id, true, options.tenant);
        spinner.succeed(`API key enabled: ${key.name}`);
        console.log('\nThe key can now be used for authentication.');
      } catch (err) {
        spinner.fail('Failed to enable API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Disable API key
  apiKeyCmd
    .command('disable <id>')
    .description('Disable an API key (block authentication without deleting)')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (id: string, options: EnableDisableOptions) => {
      const spinner = ora('Disabling API key...').start();

      try {
        const key = await client.setApiKeyEnabled(id, false, options.tenant);
        spinner.succeed(`API key disabled: ${key.name}`);
        console.log('\nThe key is now blocked from authentication.');
        console.log('Use "znvault apikey enable" to re-enable it.');
      } catch (err) {
        spinner.fail('Failed to disable API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
