// Path: src/commands/agent/remote/list.ts

/**
 * Agent list command - list agents registered with the vault
 */

import type { Command } from 'commander';

import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { RemoteListOptions, AgentListResponse } from '../types.js';
import { formatRelativeTime, formatKeyType } from '../helpers.js';

export function registerListCommand(parentCmd: Command): void {
  parentCmd
    .command('list')
    .alias('ls')
    .description('List agents registered with the vault')
    .option('--status <status>', 'Filter by status (online, offline)')
    .option('-t, --tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: RemoteListOptions) => {
      const spinner = output.spinner('Fetching agents...').start();

      try {
        const params = new URLSearchParams();
        if (options.status) params.set('status', options.status);
        if (options.tenant) params.set('tenantId', options.tenant);
        params.set('pageSize', '100');

        const query = params.toString();
        const response = await mode.apiGet<AgentListResponse>(
          `/v1/agents${query ? `?${query}` : ''}`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.agents.length === 0) {
          console.log('No agents registered');
          return;
        }

        console.log(`Total agents: ${response.pagination.totalItems}`);
        console.log();

        // Include version column as per plan
        output.table(
          ['Hostname', 'Status', 'Version', 'Last Seen', 'IP Address', 'Key Type', 'Alerts'],
          response.agents.map(a => [
            a.hostname,
            a.status === 'online' ? '● online' : '○ offline',
            a.version ? `v${a.version}` : '-',
            formatRelativeTime(a.lastSeen),
            a.lastIpAddress ?? '-',
            formatKeyType(a.apiKey),
            a.alertOnDisconnect ? 'enabled' : 'disabled',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch agents');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
