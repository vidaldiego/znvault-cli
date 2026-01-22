// Path: src/commands/secret/history.ts

/**
 * Secret history command
 */

import type { Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { HistoryOptions, HistoryResponse } from './types.js';
import { formatDate } from './helpers.js';
import { resolveSecretId } from './resolve.js';

export function registerHistoryCommand(secretCmd: Command): void {
  secretCmd
    .command('history <id-or-alias>')
    .description('Show secret version history (supports UUID or tenant/alias format)')
    .option('--json', 'Output as JSON')
    .action(async (idOrAlias: string, options: HistoryOptions) => {
      const spinner = ora('Resolving secret...').start();

      try {
        // Resolve alias to UUID if needed
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Fetching secret history...';

        const response = await client.get<HistoryResponse>(`/v1/secrets/${id}/history`);
        spinner.stop();

        const history = response.items || [];

        if (options.json) {
          output.json(response);
          return;
        }

        if (history.length === 0) {
          output.info('No version history found');
          return;
        }

        const table = new Table({
          head: ['Version', 'Created At', 'Superseded At', 'Created By'],
          colWidths: [10, 25, 25, 30],
        });

        for (const entry of history) {
          table.push([
            String(entry.version),
            formatDate(entry.createdAt),
            entry.supersededAt ? formatDate(entry.supersededAt) : '-',
            entry.createdBy || '-',
          ]);
        }

        console.log(table.toString());
        console.log(`Total: ${response.pagination.total} version(s)`);
      } catch (error) {
        spinner.fail('Failed to fetch history');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
