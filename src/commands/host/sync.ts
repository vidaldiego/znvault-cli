// Path: src/commands/host/sync.ts
// Push configuration updates to connected agents

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { SyncOptions, SyncResponse } from './types.js';

/**
 * Register the sync command
 */
export function registerSyncCommand(parentCmd: Command): void {
  parentCmd
    .command('sync <hostname>')
    .alias('push')
    .description('Push configuration update to connected agents')
    .option('-f, --force', 'Force sync even if no config changes detected')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: SyncOptions) => {
      const spinner = ora('Pushing configuration to agents...').start();

      try {
        const response = await mode.apiPost<SyncResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/sync`,
          { force: options.force ?? false }
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.linkedAgents === 0) {
          console.log(`Host: ${response.hostname} (version ${response.version})`);
          console.log();
          console.log('No agents linked to this host configuration.');
          console.log('Agents will pull the config when they connect.');
          return;
        }

        if (response.notifiedAgents === 0) {
          console.log(`Host: ${response.hostname} (version ${response.version})`);
          console.log();
          console.log(`${response.linkedAgents} agent(s) linked, but none are currently connected.`);
          console.log('Offline agents will pull the new config on next connection.');
          return;
        }

        console.log(`Host: ${response.hostname} (version ${response.version})`);
        console.log();
        console.log(`Notified ${response.notifiedAgents}/${response.linkedAgents} agent(s)`);
        console.log();

        if (response.notifiedAgents < response.linkedAgents) {
          const offline = response.linkedAgents - response.notifiedAgents;
          console.log(`Note: ${offline} agent(s) are offline and will sync on next connection.`);
        } else {
          console.log('All linked agents have been notified to pull the new configuration.');
        }
      } catch (err) {
        spinner.fail('Failed to sync configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
