// Path: src/commands/agent/remote/connections.ts

/**
 * Agent connections command - show active WebSocket connections
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { ConnectionsOptions, ConnectionsListResponse } from '../types.js';
import { formatRelativeTime } from '../helpers.js';

export function registerConnectionsCommand(parentCmd: Command): void {
  parentCmd
    .command('connections')
    .description('Show active WebSocket connections')
    .option('-t, --tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ConnectionsOptions) => {
      const spinner = ora('Fetching connections...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await mode.apiGet<ConnectionsListResponse>(
          `/v1/agents/connections${query}`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.connections.length === 0) {
          console.log('No active connections');
          return;
        }

        console.log(`Active connections: ${response.totalConnections}`);
        console.log();

        output.table(
          ['Hostname', 'Tenant', 'Version', 'Platform', 'Connected'],
          response.connections.map(c => [
            c.hostname,
            c.tenantId,
            c.version,
            c.platform,
            formatRelativeTime(c.connectedAt),
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch connections');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
