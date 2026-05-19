// Path: src/commands/apikey/rotate.ts

/**
 * API key rotate command
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { RotateOptions } from './types.js';
import { apiKeyAsSuperadmin, formatDate } from './helpers.js';

export function registerRotateCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('rotate <id>')
    .description('Rotate an API key (creates new key, invalidates old)')
    .option('-n, --name <name>', 'New name for the rotated key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: RotateOptions, cmd: Command) => {
      const spinner = output.spinner('Rotating API key...').start();
      const asSuperadmin = apiKeyAsSuperadmin(cmd);

      try {
        const result = await client.rotateApiKey(id, options.name, options.tenant, { asSuperadmin });
        spinner.succeed('API key rotated');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n⚠️  IMPORTANT: Save this new key now - it will not be shown again!');
        console.log('The old key has been invalidated.\n');
        console.log('────────────────────────────────────────────────────────────────');
        console.log(`New API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'New Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Expires': formatDate(result.apiKey.expires_at),
          'Rotation Count': result.apiKey.rotation_count,
        });
      } catch (err) {
        spinner.fail('Failed to rotate API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
