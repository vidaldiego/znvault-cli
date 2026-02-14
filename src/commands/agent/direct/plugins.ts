// Path: src/commands/agent/direct/plugins.ts

/**
 * Agent plugins command - check plugin versions on an agent
 */

import type { Command } from 'commander';

import * as output from '../../../lib/output.js';
import type { DirectCommandOptions } from '../types.js';
import { resolveHostPort, fetchPluginVersions } from '../helpers.js';

export function registerPluginsCommand(parentCmd: Command): void {
  parentCmd
    .command('plugins [hostPort]')
    .description('Check plugin versions on an agent (format: host:port or host, or select from list)')
    .option('--json', 'Output as JSON')
    .action(async (hostPort: string | undefined, options: DirectCommandOptions) => {
      const resolved = await resolveHostPort(hostPort);
      if (!resolved) {
        process.exit(1);
      }
      const { host, port } = resolved;
      const spinner = output.spinner(`Checking plugins at ${host}:${port}...`).start();

      try {
        const response = await fetchPluginVersions(host, port);
        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log();
        console.log(`Plugin Versions: ${host}:${port}`);
        console.log('═'.repeat(50));

        if (response.versions.length === 0) {
          console.log('  No plugins installed');
        } else {
          for (const plugin of response.versions) {
            const updateIcon = plugin.updateAvailable ? '\x1b[33m↑\x1b[0m' : ' ';
            const versionStr = plugin.updateAvailable
              ? `${plugin.current} → \x1b[32m${plugin.latest}\x1b[0m`
              : plugin.current;
            console.log(`  ${updateIcon} ${plugin.package}: ${versionStr}`);
          }
        }

        console.log();
        if (response.hasUpdates) {
          console.log(`\x1b[33m${response.versions.filter(v => v.updateAvailable).length} update(s) available\x1b[0m`);
          console.log(`Run: znvault agent update-plugins ${host}:${port}`);
        } else {
          console.log('\x1b[32m✓\x1b[0m All plugins up to date');
        }
        console.log();
      } catch (err) {
        spinner.fail(`Failed to check plugins at ${host}:${port}`);
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
