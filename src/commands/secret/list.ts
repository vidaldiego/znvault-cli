// Path: src/commands/secret/list.ts

/**
 * Secret list command
 */

import type { Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { ListOptions, SecretsListResponse } from './types.js';
import { formatDate, formatType, formatTags, truncateAlias, formatExpiry } from './helpers.js';

export function registerListCommand(secretCmd: Command): void {
  secretCmd
    .command('list')
    .description('List secrets (metadata only)')
    .option('-t, --tenant <id>', 'Filter by tenant')
    .option('--type <type>', 'Filter by type (opaque, credential, setting)')
    .option('--sub-type <subType>', 'Filter by sub-type')
    .option('--alias-prefix <prefix>', 'Filter by alias prefix')
    .option('--expiring <days>', 'Show secrets expiring within N days')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching secrets...').start();

      try {
        const query: Record<string, string | undefined> = {};
        if (options.tenant) query.tenant = options.tenant;
        if (options.type) query.type = options.type;
        if (options.subType) query.subType = options.subType;
        if (options.aliasPrefix) query.aliasPrefix = options.aliasPrefix;
        if (options.expiring) {
          const days = parseInt(options.expiring, 10);
          const expiringBefore = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          query.expiringBefore = expiringBefore;
        }

        const response = await client.get<SecretsListResponse>('/v1/secrets?' + new URLSearchParams(query as Record<string, string>).toString());
        const secrets = response.items;
        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (secrets.length === 0) {
          output.info('No secrets found');
          return;
        }

        const table = new Table({
          head: ['ID', 'Alias', 'Tenant', 'Type', 'Ver', 'Expires', 'Tags', 'Updated'],
          colWidths: [12, 42, 12, 16, 5, 14, 20, 20],
          wordWrap: true,
        });

        for (const secret of secrets) {
          table.push([
            secret.id.slice(0, 10) + '...',
            truncateAlias(secret.alias),
            secret.tenant.slice(0, 10),
            formatType(secret.type, secret.subType),
            String(secret.version),
            formatExpiry(secret.expiresAt || secret.ttlUntil),
            formatTags(secret.tags),
            formatDate(secret.updatedAt).split(',')[0], // Just date
          ]);
        }

        console.log(table.toString());
        output.info(`Total: ${response.pagination.total} secret(s)${response.pagination.hasMore ? ' (more available)' : ''}`);
      } catch (error) {
        spinner.fail('Failed to list secrets');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
