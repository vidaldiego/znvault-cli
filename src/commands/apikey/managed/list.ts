// Path: src/commands/apikey/managed/list.ts

/**
 * Managed API key list command
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { client } from '../../../lib/client.js';
import * as output from '../../../lib/output.js';
import type { ManagedListOptions } from './types.js';
import { formatRotationMode, formatTimeUntil } from './helpers.js';
import { apiKeyAsSuperadmin } from '../helpers.js';

export function registerManagedListCommand(managedCmd: Command): void {
  managedCmd
    .command('list')
    .alias('ls')
    .description('List all managed API keys')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ManagedListOptions, cmd: Command) => {
      const spinner = output.spinner('Fetching managed API keys...').start();
      const asSuperadmin = apiKeyAsSuperadmin(cmd);

      try {
        const result = await client.listManagedApiKeys(options.tenant, { asSuperadmin });
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.warn('No managed API keys found');
          return;
        }

        const table = new Table({
          head: ['Name', 'Mode', 'Interval', 'Grace', 'Next Rotation', 'Status', 'Tenant', 'Rotations'],
          style: { head: ['cyan'] },
        });

        for (const key of result.items) {
          const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          const nextRotation = key.next_rotation_at ? formatTimeUntil(key.next_rotation_at) : '-';

          table.push([
            key.name,
            formatRotationMode(key.rotation_mode),
            key.rotation_interval ?? '-',
            key.grace_period,
            nextRotation,
            `${statusIcon} ${key.enabled ? 'Active' : 'Disabled'}`,
            key.tenant_id,
            key.rotation_count > 0 ? `${key.rotation_count}x` : '-',
          ]);
        }

        console.log(table.toString());
        const showingInfo = result.pagination.hasMore
          ? `Showing ${result.items.length} of ${result.pagination.total}`
          : `Total: ${result.pagination.total}`;
        console.log(`\n${showingInfo} managed API key(s)`);
      } catch (err) {
        spinner.fail('Failed to list managed API keys');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
