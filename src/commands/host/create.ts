// Path: src/commands/host/create.ts
// Create a new host configuration

import fs from 'node:fs';
import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { CreateOptions, HostConfig } from './types.js';
import { validateHostname, printHostDetails } from './helpers.js';

/**
 * Register the create command
 */
export function registerCreateCommand(parentCmd: Command): void {
  parentCmd
    .command('create <hostname>')
    .description('Create a new host configuration')
    .option('-m, --managed-key <name>', 'Managed API key name for this host')
    .option('-d, --description <text>', 'Host description')
    .option('-c, --config-file <path>', 'Import config from JSON file')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: CreateOptions) => {
      // Validate hostname
      const validation = validateHostname(hostname);
      if (!validation.valid) {
        output.error(validation.error ?? 'Invalid hostname');
        process.exit(1);
      }

      // Load config from file if provided
      let config: HostConfig['config'] = {};
      if (options.configFile) {
        try {
          const content = fs.readFileSync(options.configFile, 'utf-8');
          config = JSON.parse(content) as HostConfig['config'];
        } catch (err) {
          output.error(`Failed to read config file: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      const spinner = ora('Creating host configuration...').start();

      try {
        const response = await mode.apiPost<HostConfig>('/v1/hosts', {
          hostname,
          description: options.description,
          managedKeyName: options.managedKey,
          config,
        });

        spinner.succeed('Host configuration created');

        if (options.json) {
          output.json(response);
          return;
        }

        printHostDetails(response);

        // Show next steps
        console.log('Next steps:');
        console.log(`  1. Edit config:       znvault host config ${hostname} --edit`);
        console.log(`  2. Generate token:    znvault host bootstrap-token ${hostname}`);
        console.log(`  3. Install agent:     curl -sL <vault>/agent/bootstrap.sh | sudo bash -s -- --token <token>`);
        console.log();
      } catch (err) {
        spinner.fail('Failed to create host configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
