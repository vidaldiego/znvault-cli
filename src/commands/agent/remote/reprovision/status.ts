// Path: src/commands/agent/remote/reprovision/status.ts

/**
 * Reprovision status command - check reprovision status and pending tokens
 */

import type { Command } from 'commander';

import * as mode from '../../../../lib/mode.js';
import * as output from '../../../../lib/output.js';
import type { StatusOptions, ReprovisionStatusResponse } from '../../types.js';
import { formatRelativeTime } from '../../helpers.js';

export function registerReprovisionStatusCommand(parentCmd: Command): void {
  parentCmd
    .command('status <agent-id>')
    .description('Check reprovision status and pending tokens for an agent')
    .option('--json', 'Output as JSON')
    .action(async (agentId: string, options: StatusOptions) => {
      const spinner = output.spinner('Fetching reprovision status...').start();

      try {
        const response = await mode.apiGet<ReprovisionStatusResponse>(
          `/v1/agents/${encodeURIComponent(agentId)}/reprovision/status`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log(`Agent: ${response.hostname} (${response.agentId})`);
        console.log();
        console.log('Connection State:');
        console.log(`  Current state: ${response.connectionState}`);
        if (response.lastHealthyAt) {
          console.log(`  Last healthy:  ${formatRelativeTime(response.lastHealthyAt)}`);
        }
        if (response.lastDegradedAt) {
          console.log(`  Last degraded: ${formatRelativeTime(response.lastDegradedAt)}`);
        }
        if (response.degradedReason) {
          console.log(`  Degraded reason: ${response.degradedReason}`);
        }
        console.log();

        if (response.hasPendingToken && response.pendingToken) {
          console.log('Pending Reprovision Token:');
          console.log(`  Token ID:   ${response.pendingToken.id}`);
          console.log(`  Created:    ${formatRelativeTime(response.pendingToken.createdAt)}`);
          console.log(`  Expires:    ${new Date(response.pendingToken.expiresAt).toLocaleString()}`);
          if (response.pendingToken.createdBy) {
            console.log(`  Created by: ${response.pendingToken.createdBy}`);
          }
          if (response.pendingToken.reason) {
            console.log(`  Reason:     ${response.pendingToken.reason}`);
          }
        } else {
          console.log('No pending reprovision token');
        }
      } catch (err) {
        spinner.fail('Failed to fetch reprovision status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
