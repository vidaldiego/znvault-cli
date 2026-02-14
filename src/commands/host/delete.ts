// Path: src/commands/host/delete.ts
// Delete a host configuration

import type { Command } from 'commander';

import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import { promptConfirm } from '../../lib/prompts.js';
import type { DeleteOptions, HostConfig } from './types.js';

/**
 * Register the delete command
 */
export function registerDeleteCommand(parentCmd: Command): void {
  parentCmd
    .command('delete <hostname>')
    .description('Delete a host configuration')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (hostname: string, options: DeleteOptions) => {
      // Confirm deletion
      if (!options.yes) {
        const confirmed = await promptConfirm(
          `Delete host configuration for '${hostname}'? This cannot be undone.`
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const spinner = output.spinner('Deleting host configuration...').start();

      try {
        // First get the host to show what's being deleted
        const host = await mode.apiGet<HostConfig>(
          `/v1/hosts/${encodeURIComponent(hostname)}`
        );

        // Delete
        await mode.apiDelete(`/v1/hosts/${encodeURIComponent(hostname)}`);

        spinner.succeed(`Host configuration '${hostname}' deleted`);

        // Show info about what was deleted
        const certCount = host.config.targets?.length ?? 0;
        const secretCount = host.config.secretTargets?.length ?? 0;
        const pluginCount = host.config.plugins?.filter((p) => p.enabled !== false).length ?? 0;

        if (certCount > 0 || secretCount > 0 || pluginCount > 0) {
          console.log();
          console.log('The following configuration was removed:');
          if (certCount > 0) console.log(`  - ${certCount} certificate target(s)`);
          if (secretCount > 0) console.log(`  - ${secretCount} secret target(s)`);
          if (pluginCount > 0) console.log(`  - ${pluginCount} plugin(s)`);
        }

        console.log();
        console.log('Note: Connected agents will continue running with their last known config.');
        console.log('      They will fail to pull new config until re-bootstrapped.');
      } catch (err) {
        spinner.fail('Failed to delete host configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
