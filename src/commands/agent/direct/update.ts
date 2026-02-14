// Path: src/commands/agent/direct/update.ts

/**
 * Agent update command - trigger agent self-update
 */

import type { Command } from 'commander';

import * as output from '../../../lib/output.js';
import type { UpdateCommandOptions } from '../types.js';
import {
  resolveHostPort,
  fetchAgentVersion,
  triggerAgentUpdate,
  confirmAction,
  waitForAgentRestart,
} from '../helpers.js';

export function registerUpdateCommand(parentCmd: Command): void {
  parentCmd
    .command('update [hostPort]')
    .description('Trigger agent self-update (format: host:port or host, or select from list)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (hostPort: string | undefined, options: UpdateCommandOptions) => {
      const resolved = await resolveHostPort(hostPort);
      if (!resolved) {
        process.exit(1);
      }
      const { host, port } = resolved;

      // First check what version is available
      const checkSpinner = output.spinner(`Checking agent version at ${host}:${port}...`).start();

      let versionInfo;
      try {
        versionInfo = await fetchAgentVersion(host, port);
        checkSpinner.stop();
      } catch (err) {
        checkSpinner.fail(`Failed to check agent version at ${host}:${port}`);
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (!versionInfo.updateAvailable) {
        if (options.json) {
          output.json({ updated: false, message: 'Agent is already at latest version', current: versionInfo.current });
        } else {
          console.log(`\x1b[32m✓\x1b[0m Agent is already at latest version (v${versionInfo.current})`);
        }
        return;
      }

      if (!versionInfo.autoUpdateEnabled) {
        if (options.json) {
          output.json({ updated: false, message: 'Auto-update is disabled on this agent', current: versionInfo.current });
        } else {
          console.log(`\x1b[33m⚠\x1b[0m Auto-update is disabled on this agent`);
          console.log('  Enable with AUTO_UPDATE=true environment variable');
        }
        return;
      }

      // Show what will be updated
      if (!options.json) {
        console.log();
        console.log('Agent update:');
        console.log(`  ${versionInfo.current} → \x1b[32m${versionInfo.latest}\x1b[0m`);
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
      const updateSpinner = output.spinner('Updating agent...').start();

      try {
        const response = await triggerAgentUpdate(host, port);
        updateSpinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (!response.success) {
          console.log(`\x1b[31m✗\x1b[0m Update failed: ${response.message}`);
          process.exit(1);
        }

        console.log(`\x1b[32m✓\x1b[0m ${response.message}`);
        console.log(`  ${response.previousVersion} → ${response.newVersion}`);

        if (response.willRestart) {
          console.log();
          await waitForAgentRestart(host, port);
        }
      } catch (err) {
        updateSpinner.fail('Failed to update agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
