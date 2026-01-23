// Path: src/commands/host/bootstrap-token.ts
// Generate bootstrap token for host

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { BootstrapTokenOptions, BootstrapTokenResponse } from './types.js';
import { parseDuration } from './helpers.js';

/**
 * Register the bootstrap-token command
 */
export function registerBootstrapTokenCommand(parentCmd: Command): void {
  parentCmd
    .command('bootstrap-token <hostname>')
    .alias('token')
    .description('Generate a bootstrap token for a host')
    .option('-e, --expires <duration>', 'Token expiration (e.g., 1h, 24h, 7d)', '24h')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: BootstrapTokenOptions) => {
      // Parse expiration
      let expiresAt: string;
      try {
        const expirationDate = parseDuration(options.expires ?? '24h');
        expiresAt = expirationDate.toISOString();
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const spinner = ora('Generating bootstrap token...').start();

      try {
        const response = await mode.apiPost<BootstrapTokenResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/bootstrap-token`,
          { expiresAt }
        );

        spinner.succeed('Bootstrap token generated');

        if (options.json) {
          output.json(response);
          return;
        }

        // Build the one-command URL
        const oneCommandUrl = `${response.bootstrapUrl}?token=${response.token}`;

        console.log();
        output.section('Bootstrap Token for ' + hostname);
        console.log();
        output.keyValue({
          'Token': response.token,
          'Expires': new Date(response.expiresAt).toLocaleString(),
        });

        console.log();
        output.section('Quick Start (One Command)');
        console.log();
        console.log('  Run this on the target server to install and configure the agent:');
        console.log();
        console.log(`    curl -sL "${oneCommandUrl}" | sudo bash`);
        console.log();

        output.section('Review First (Recommended)');
        console.log();
        console.log('  Download the script, review it, then run:');
        console.log();
        console.log(`    curl -sL "${oneCommandUrl}" -o bootstrap-${hostname}.sh`);
        console.log(`    less bootstrap-${hostname}.sh`);
        console.log(`    sudo bash bootstrap-${hostname}.sh`);
        console.log();

        output.section('Alternative: Manual Installation');
        console.log();
        console.log('  If you prefer to install manually:');
        console.log();
        console.log('    sudo npm install -g @zincapp/zn-vault-agent');
        console.log('    # Then add the bootstrap token to /etc/zn-vault-agent/config.json');
        console.log();

        output.info(`Token expires in ${options.expires ?? '24h'} and can only be used once.`);
      } catch (err) {
        spinner.fail('Failed to generate bootstrap token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
