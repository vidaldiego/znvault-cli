// Path: src/commands/secret/copy.ts

/**
 * Secret copy command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { CopyOptions, CopyResponse } from './types.js';
import { formatType } from './helpers.js';

export function registerCopyCommand(secretCmd: Command): void {
  secretCmd
    .command('copy <source> <destination-alias>')
    .description('Copy a secret to a new location')
    .option('--no-metadata', 'Do not copy tags/metadata')
    .option('--json', 'Output as JSON')
    .action(async (source: string, destinationAlias: string, options: CopyOptions) => {
      const spinner = ora('Copying secret...').start();

      try {
        const body: Record<string, unknown> = {
          source,
          destinationAlias,
          includeMetadata: !options.noMetadata,
        };

        const result = await client.post<CopyResponse>('/v1/secrets/copy', body);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        output.success('Secret copied successfully!');
        console.log(`  New ID:     ${result.id}`);
        console.log(`  New Alias:  ${result.alias}`);
        console.log(`  Tenant:     ${result.tenant}`);
        console.log(`  Type:       ${formatType(result.type, result.subType)}`);
        console.log(`  Copied From:`);
        console.log(`    ID:       ${result.copiedFrom.id}`);
        console.log(`    Alias:    ${result.copiedFrom.alias}`);
        console.log(`    Version:  ${result.copiedFrom.version}`);
      } catch (error) {
        spinner.fail('Failed to copy secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
