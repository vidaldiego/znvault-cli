// Path: src/commands/host/list.ts
// List host configurations

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { ListOptions, HostListResponse, HostStatsResponse } from './types.js';
import { formatStatus, formatRelativeTime, formatConfigSummary } from './helpers.js';

/**
 * Register the list command
 */
export function registerListCommand(parentCmd: Command): void {
  parentCmd
    .command('list')
    .alias('ls')
    .description('List all host configurations')
    .option('--status <status>', 'Filter by status (active, disabled, pending)')
    .option('-t, --tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .option('--page <number>', 'Page number', '1')
    .option('--page-size <number>', 'Items per page', '50')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching host configurations...').start();

      try {
        const params = new URLSearchParams();
        if (options.status) params.set('status', options.status);
        if (options.tenant) params.set('tenantId', options.tenant);
        params.set('page', String(options.page ?? 1));
        params.set('pageSize', String(options.pageSize ?? 50));

        const query = params.toString();
        const response = await mode.apiGet<HostListResponse>(
          `/v1/hosts${query ? `?${query}` : ''}`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          console.log('No host configurations found.');
          console.log();
          console.log('Create one with: znvault host create <hostname>');
          return;
        }

        console.log(`Found ${response.pagination.totalItems} host(s) (page ${response.pagination.page}/${response.pagination.totalPages})`);
        console.log();

        output.table(
          ['Hostname', 'Status', 'Version', 'Config', 'Last Pull', 'Managed Key'],
          response.items.map((host) => [
            host.hostname,
            formatStatus(host.status),
            String(host.version),
            formatConfigSummary(host.config),
            formatRelativeTime(host.lastPulledAt),
            host.managedKeyName ?? '-',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to list hosts');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

/**
 * Register the stats command
 */
export function registerStatsCommand(parentCmd: Command): void {
  parentCmd
    .command('stats')
    .description('Show host configuration statistics')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spinner = ora('Fetching statistics...').start();

      try {
        const response = await mode.apiGet<HostStatsResponse>('/v1/hosts/stats');

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log('Host Configuration Statistics');
        console.log('─'.repeat(35));
        console.log(`  Total hosts:      ${response.total}`);
        console.log(`  Active:           ${response.byStatus.active ?? 0}`);
        console.log(`  Disabled:         ${response.byStatus.disabled ?? 0}`);
        console.log(`  Pending:          ${response.byStatus.pending ?? 0}`);
        console.log(`  Recently pulled:  ${response.recentlyPulled}`);
        console.log(`  Avg version:      ${response.averageVersion.toFixed(1)}`);
      } catch (err) {
        spinner.fail('Failed to get statistics');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
