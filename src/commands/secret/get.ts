// Path: src/commands/secret/get.ts

/**
 * Secret get command (metadata only)
 */

import type { Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { GetOptions, SecretMetadata } from './types.js';
import { formatDate, formatType, formatBytes } from './helpers.js';
import { resolveSecretId } from './resolve.js';

export function registerGetCommand(secretCmd: Command): void {
  secretCmd
    .command('get <id-or-alias>')
    .description('Get secret metadata (supports UUID or tenant/alias format)')
    .option('--json', 'Output as JSON')
    .action(async (idOrAlias: string, options: GetOptions) => {
      const spinner = ora('Resolving secret...').start();

      try {
        // Resolve alias to UUID if needed
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Fetching secret metadata...';

        const secret = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
        spinner.stop();

        if (options.json) {
          output.json(secret);
          return;
        }

        const table = new Table({
          colWidths: [20, 60],
        });

        table.push(
          ['ID', secret.id],
          ['Alias', secret.alias],
          ['Tenant', secret.tenant],
          ['Type', formatType(secret.type, secret.subType)],
          ['Version', String(secret.version)],
        );

        if (secret.fileName) {
          table.push(['File Name', secret.fileName]);
        }
        if (secret.fileSize) {
          table.push(['File Size', formatBytes(secret.fileSize)]);
        }
        if (secret.fileMime) {
          table.push(['MIME Type', secret.fileMime]);
        }
        if (secret.contentType) {
          table.push(['Content Type', secret.contentType]);
        }
        if (secret.expiresAt) {
          table.push(['Expires At', formatDate(secret.expiresAt)]);
        }
        if (secret.ttlUntil) {
          table.push(['TTL Until', formatDate(secret.ttlUntil)]);
        }
        if (secret.tags && secret.tags.length > 0) {
          table.push(['Tags', secret.tags.join(', ')]);
        }
        table.push(
          ['Created By', secret.createdBy || '-'],
          ['Created At', formatDate(secret.createdAt)],
          ['Updated At', formatDate(secret.updatedAt)],
        );

        console.log(table.toString());
      } catch (error) {
        spinner.fail('Failed to get secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
