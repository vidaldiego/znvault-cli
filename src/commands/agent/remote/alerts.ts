// Path: src/commands/agent/remote/alerts.ts

/**
 * Agent alerts command - configure disconnect alerts
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { AlertsOptions, RemoteAgent } from '../types.js';

export function registerAlertsCommand(parentCmd: Command): void {
  parentCmd
    .command('alerts <agent-id>')
    .description('Configure disconnect alerts for an agent')
    .option('--enable', 'Enable disconnect alerts')
    .option('--disable', 'Disable disconnect alerts')
    .option('--threshold <seconds>', 'Set disconnect threshold in seconds', '600')
    .action(async (agentId: string, options: AlertsOptions) => {
      if (!options.enable && !options.disable) {
        output.error('Specify --enable or --disable');
        process.exit(1);
      }

      const spinner = ora('Updating agent alerts...').start();

      try {
        const payload: { alertOnDisconnect?: boolean; disconnectThresholdSeconds?: number } = {};

        if (options.enable) payload.alertOnDisconnect = true;
        if (options.disable) payload.alertOnDisconnect = false;
        if (options.threshold) payload.disconnectThresholdSeconds = parseInt(options.threshold, 10);

        const remoteAgent = await mode.apiPatch<RemoteAgent>(
          `/v1/agents/${encodeURIComponent(agentId)}/alerts`,
          payload
        );

        spinner.succeed(`Alerts ${remoteAgent.alertOnDisconnect ? 'enabled' : 'disabled'} for ${remoteAgent.hostname}`);

        if (remoteAgent.alertOnDisconnect) {
          console.log(`  Threshold: ${remoteAgent.disconnectThresholdSeconds} seconds`);
        }
      } catch (err) {
        spinner.fail('Failed to update alerts');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
