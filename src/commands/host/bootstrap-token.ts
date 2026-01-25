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
    .option('-a, --agent-hostname <hostname>', 'Agent hostname (for multi-host templates, defaults to host config name)')
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
        // Build request body
        const body: Record<string, unknown> = { expiresAt };
        if (options.agentHostname) {
          body.agentHostname = options.agentHostname;
        }

        const response = await mode.apiPost<BootstrapTokenResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/bootstrap-token`,
          body
        );

        spinner.succeed('Bootstrap token generated');

        if (options.json) {
          output.json(response);
          return;
        }

        // Use bootstrapUrl directly (now includes token and hostname)
        const bootstrapUrl = response.bootstrapUrl;
        const agentHostname = response.agentHostname;
        const isMultiHost = agentHostname !== hostname;

        console.log();
        if (isMultiHost) {
          output.section(`Bootstrap Token for ${agentHostname} (template: ${hostname})`);
        } else {
          output.section('Bootstrap Token for ' + hostname);
        }
        console.log();

        const tokenInfo: Record<string, string> = {
          'Token': response.token,
          'Expires': new Date(response.expiresAt).toLocaleString(),
        };
        if (isMultiHost) {
          tokenInfo['Host Config'] = hostname;
          tokenInfo['Agent Hostname'] = agentHostname;
        }
        output.keyValue(tokenInfo);

        console.log();
        output.section('Quick Start (One Command)');
        console.log();
        console.log('  Run this on the target server to install and configure the agent:');
        console.log();
        console.log(`    curl -sL "${bootstrapUrl}" | sudo bash`);
        console.log();

        output.section('Review First (Recommended)');
        console.log();
        console.log('  Download the script, review it, then run:');
        console.log();
        console.log(`    curl -sL "${bootstrapUrl}" -o bootstrap-${agentHostname}.sh`);
        console.log(`    less bootstrap-${agentHostname}.sh`);
        console.log(`    sudo bash bootstrap-${agentHostname}.sh`);
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
