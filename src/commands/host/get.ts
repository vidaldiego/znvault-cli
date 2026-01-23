// Path: src/commands/host/get.ts
// Get host configuration details

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { GetOptions, HostConfig, OutdatedAgentsResponse } from './types.js';
import { printHostDetails, formatRelativeTime } from './helpers.js';

/**
 * Register the get command
 */
export function registerGetCommand(parentCmd: Command): void {
  parentCmd
    .command('get <hostname>')
    .description('Get host configuration details')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: GetOptions) => {
      const spinner = ora('Fetching host configuration...').start();

      try {
        const response = await mode.apiGet<HostConfig>(
          `/v1/hosts/${encodeURIComponent(hostname)}`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        printHostDetails(response);
      } catch (err) {
        spinner.fail('Failed to get host configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

/**
 * Register the outdated-agents command
 */
export function registerOutdatedAgentsCommand(parentCmd: Command): void {
  parentCmd
    .command('outdated-agents <hostname>')
    .description('List agents with outdated configuration')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: { json?: boolean }) => {
      const spinner = ora('Checking for outdated agents...').start();

      try {
        const response = await mode.apiGet<OutdatedAgentsResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/outdated-agents`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log(`Host: ${response.hostname} (version ${response.currentVersion})`);
        console.log();

        if (response.agents.length === 0) {
          console.log('All linked agents are up to date.');
          return;
        }

        console.log(`Found ${response.agents.length} agent(s) with outdated config:`);
        console.log();

        output.table(
          ['Agent ID', 'Config Version', 'Versions Behind'],
          response.agents.map((agent) => [
            agent.agentId.substring(0, 12) + '...',
            agent.configVersion?.toString() ?? 'never pulled',
            String(agent.versionsBehind),
          ])
        );

        console.log();
        console.log(`To push updates: znvault host sync ${hostname}`);
      } catch (err) {
        spinner.fail('Failed to check outdated agents');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
