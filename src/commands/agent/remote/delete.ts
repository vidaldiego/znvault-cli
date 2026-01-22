// Path: src/commands/agent/remote/delete.ts

/**
 * Agent delete command - remove an agent from the vault
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { DeleteOptions } from '../types.js';
import { confirmAction } from '../helpers.js';

export function registerDeleteCommand(parentCmd: Command): void {
  parentCmd
    .command('delete <agent-id>')
    .description('Remove an agent from the vault')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: DeleteOptions) => {
      if (!options.yes) {
        const confirmed = await confirmAction(
          `Delete agent ${agentId}? This will remove all activity history.`
        );
        if (!confirmed) {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Deleting agent...').start();

      try {
        await mode.apiDelete(`/v1/agents/${encodeURIComponent(agentId)}`);
        spinner.succeed('Agent deleted');
      } catch (err) {
        spinner.fail('Failed to delete agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
