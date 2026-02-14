// Path: src/commands/apikey/list.ts

/**
 * API key list command
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { ListOptions } from './types.js';
import {
  formatExpiry,
  formatPermissions,
  formatSecondsToHuman,
  getDaysUntilExpiry,
} from './helpers.js';

export function registerListCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('list')
    .alias('ls')
    .description('List API keys')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = output.spinner('Fetching API keys...').start();

      try {
        const result = await client.listApiKeys(options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.warn('No API keys found');
          return;
        }

        // Show expiring soon warning
        if (result.expiringSoon.length > 0) {
          console.log(`\n⚠️  ${result.expiringSoon.length} key(s) expiring within 7 days\n`);
        }

        const table = new Table({
          head: ['Name', 'Prefix', 'Type', 'Status', 'Tenant', 'Permissions', 'Expires', 'Rotations'],
          style: { head: ['cyan'] },
        });

        for (const key of result.items) {
          const daysLeft = getDaysUntilExpiry(key.expires_at);
          const expiryColor = daysLeft <= 7 ? '\x1b[31m' : daysLeft <= 30 ? '\x1b[33m' : '';
          const reset = expiryColor ? '\x1b[0m' : '';
          const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          const statusText = key.enabled ? 'Active' : 'Disabled';

          // Format key type (static vs managed with rotation info)
          let keyType = 'Static';
          if (key.is_managed && key.rotation_mode) {
            const mode = key.rotation_mode.replace('on-', '');
            const interval = key.rotation_interval_seconds
              ? formatSecondsToHuman(key.rotation_interval_seconds)
              : '';
            keyType = interval ? `${mode}/${interval}` : mode;
          }

          table.push([
            key.name,
            key.prefix,
            keyType,
            `${statusIcon} ${statusText}`,
            key.tenant_id,
            formatPermissions(key.permissions),
            `${expiryColor}${formatExpiry(key.expires_at)}${reset}`,
            key.rotation_count > 0 ? `${key.rotation_count}x` : '-',
          ]);
        }

        console.log(table.toString());
        const showingInfo = result.pagination.hasMore
          ? `Showing ${result.items.length} of ${result.pagination.total}`
          : `Total: ${result.pagination.total}`;
        console.log(`\n${showingInfo} API key(s)`);
      } catch (err) {
        spinner.fail('Failed to list API keys');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
