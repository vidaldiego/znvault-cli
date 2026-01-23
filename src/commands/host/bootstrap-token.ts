// Path: src/commands/host/bootstrap-token.ts
// Generate bootstrap token for host

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { BootstrapTokenOptions, BootstrapTokenResponse } from './types.js';
import { parseDuration, formatRelativeTime } from './helpers.js';

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

        console.log();
        console.log('Bootstrap Token for ' + hostname);
        console.log('─'.repeat(60));
        console.log();
        console.log('  Token:    ' + response.token);
        console.log('  Expires:  ' + new Date(response.expiresAt).toLocaleString());
        console.log();
        console.log('Bootstrap Commands:');
        console.log();
        console.log('  # Option 1: Use bootstrap script (recommended)');
        console.log(`  curl -sL ${response.bootstrapUrl} | sudo bash -s -- --token ${response.token}`);
        console.log();
        console.log('  # Option 2: Manual installation');
        console.log('  sudo npm install -g @zincapp/zn-vault-agent');
        console.log(`  sudo zn-vault-agent bootstrap --token ${response.token}`);
        console.log();
        console.log('Note: The token can only be used once and expires in ' + (options.expires ?? '24h'));
      } catch (err) {
        spinner.fail('Failed to generate bootstrap token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
