// Path: src/commands/agent/remote/reprovision/cancel.ts

/**
 * Reprovision cancel command - cancel a pending reprovision token
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../../lib/mode.js';
import * as output from '../../../../lib/output.js';
import { confirmAction } from '../../helpers.js';

export function registerReprovisionCancelCommand(parentCmd: Command): void {
  parentCmd
    .command('cancel <agent-id>')
    .description('Cancel a pending reprovision token')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirmAction('Cancel the pending reprovision token?');
        if (!confirmed) {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Cancelling reprovision token...').start();

      try {
        await mode.apiDelete(`/v1/agents/${encodeURIComponent(agentId)}/reprovision`);
        spinner.succeed('Reprovision token cancelled');
        console.log('The agent will need a new token to be reprovisioned.');
      } catch (err) {
        spinner.fail('Failed to cancel reprovision token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
