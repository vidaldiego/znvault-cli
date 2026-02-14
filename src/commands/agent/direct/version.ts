// Path: src/commands/agent/direct/version.ts

/**
 * Agent version command - check agent version and available updates
 */

import type { Command } from 'commander';

import * as output from '../../../lib/output.js';
import type { DirectCommandOptions } from '../types.js';
import { resolveHostPort, fetchAgentVersion } from '../helpers.js';

export function registerVersionCommand(parentCmd: Command): void {
  parentCmd
    .command('version [hostPort]')
    .description('Check agent version and available updates (format: host:port or host, or select from list)')
    .option('--json', 'Output as JSON')
    .action(async (hostPort: string | undefined, options: DirectCommandOptions) => {
      const resolved = await resolveHostPort(hostPort);
      if (!resolved) {
        process.exit(1);
      }
      const { host, port } = resolved;
      const spinner = output.spinner(`Checking agent version at ${host}:${port}...`).start();

      try {
        const response = await fetchAgentVersion(host, port);
        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log();
        console.log(`Agent Version: ${host}:${port}`);
        console.log('═'.repeat(40));
        console.log(`  Current:     v${response.current}`);
        console.log(`  Latest:      v${response.latest}`);
        console.log(`  Auto-update: ${response.autoUpdateEnabled ? 'Enabled' : 'Disabled'}`);
        console.log();

        if (response.updateAvailable) {
          console.log(`\x1b[33m↑ Update available: ${response.current} → ${response.latest}\x1b[0m`);
          console.log(`Run: znvault agent update ${host}:${port}`);
        } else {
          console.log('\x1b[32m✓\x1b[0m Agent is up to date');
        }
        console.log();
      } catch (err) {
        spinner.fail(`Failed to check agent version at ${host}:${port}`);
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
