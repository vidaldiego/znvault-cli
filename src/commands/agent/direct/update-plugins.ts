// Path: src/commands/agent/direct/update-plugins.ts

/**
 * Agent update-plugins command - trigger plugin updates on an agent
 */

import type { Command } from 'commander';

import * as output from '../../../lib/output.js';
import type { UpdateCommandOptions } from '../types.js';
import {
  resolveHostPort,
  fetchPluginVersions,
  triggerPluginUpdate,
  confirmAction,
  waitForAgentRestart,
} from '../helpers.js';

export function registerUpdatePluginsCommand(parentCmd: Command): void {
  parentCmd
    .command('update-plugins [hostPort]')
    .description('Trigger plugin updates on an agent (format: host:port or host, or select from list)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (hostPort: string | undefined, options: UpdateCommandOptions) => {
      const resolved = await resolveHostPort(hostPort);
      if (!resolved) {
        process.exit(1);
      }
      const { host, port } = resolved;

      // First check what needs updating
      const checkSpinner = output.spinner(`Checking plugins at ${host}:${port}...`).start();

      let versions;
      try {
        versions = await fetchPluginVersions(host, port);
        checkSpinner.stop();
      } catch (err) {
        checkSpinner.fail(`Failed to check plugins at ${host}:${port}`);
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (!versions.hasUpdates) {
        if (options.json) {
          output.json({ updated: 0, message: 'All plugins up to date' });
        } else {
          console.log('\x1b[32m✓\x1b[0m All plugins are up to date');
        }
        return;
      }

      // Show what will be updated
      if (!options.json) {
        console.log();
        console.log('Updates available:');
        for (const plugin of versions.versions) {
          if (plugin.updateAvailable) {
            console.log(`  ${plugin.package}: ${plugin.current} → \x1b[32m${plugin.latest}\x1b[0m`);
          }
        }
        console.log();
      }

      // Confirm
      if (!options.yes && !options.json) {
        const confirmed = await confirmAction('Proceed with update? Agent will restart.');
        if (!confirmed) {
          console.log('Cancelled');
          return;
        }
      }

      // Trigger update
      const updateSpinner = output.spinner('Updating plugins...').start();

      try {
        const response = await triggerPluginUpdate(host, port);
        updateSpinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.updated === 0) {
          console.log('No updates were applied');
          return;
        }

        console.log(`\x1b[32m✓\x1b[0m Updated ${response.updated} plugin(s)`);
        for (const result of response.results) {
          if (result.success) {
            console.log(`  ${result.package}: ${result.previousVersion} → ${result.newVersion}`);
          } else {
            console.log(`  \x1b[31m✗\x1b[0m ${result.package}: ${result.error}`);
          }
        }

        if (response.willRestart) {
          console.log();
          await waitForAgentRestart(host, port);
        }
      } catch (err) {
        updateSpinner.fail('Failed to update plugins');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
