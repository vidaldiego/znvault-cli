// Path: src/commands/apikey/self.ts

/**
 * API key self commands (for API key authenticated requests)
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { SelfOptions, SelfRotateOptions } from './types.js';
import { formatDate, displayConditions } from './helpers.js';

export function registerSelfCommands(apiKeyCmd: Command): void {
  // Self-info (when using API key auth)
  apiKeyCmd
    .command('self')
    .description('Show info about the currently used API key')
    .option('--json', 'Output as JSON')
    .action(async (options: SelfOptions) => {
      const spinner = output.spinner('Fetching API key info...').start();

      try {
        const result = await client.getApiKeySelf();
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        const statusIcon = result.apiKey.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

        output.keyValue({
          'Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Status': statusIcon,
          'Tenant': result.apiKey.tenant_id,
          'Description': result.apiKey.description ?? 'None',
          'Expires': formatDate(result.apiKey.expires_at),
          'Days Until Expiry': result.expiresInDays,
          'Expiring Soon': result.isExpiringSoon ? 'Yes (!)' : 'No',
          'Last Used': result.apiKey.last_used ? formatDate(result.apiKey.last_used) : 'Never',
          'Rotation Count': result.apiKey.rotation_count,
          'Last Rotation': result.apiKey.last_rotation ? formatDate(result.apiKey.last_rotation) : 'Never',
        });

        if (result.apiKey.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.apiKey.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const apiKeyConditions = result.apiKey.conditions;
        if (apiKeyConditions && Object.keys(apiKeyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(apiKeyConditions);
        }

        if (result.isExpiringSoon) {
          console.log('\n⚠️  This key is expiring soon! Run "znvault apikey self-rotate" to rotate it.');
        }
      } catch (err) {
        spinner.fail('Failed to fetch API key info');
        output.error(err instanceof Error ? err.message : String(err));
        console.log('\nNote: This command only works when authenticated via API key (X-API-Key header).');
        process.exit(1);
      }
    });

  // Self-rotate (when using API key auth)
  apiKeyCmd
    .command('self-rotate')
    .description('Rotate the currently used API key')
    .option('-n, --name <name>', 'New name for the rotated key')
    .option('--json', 'Output as JSON')
    .action(async (options: SelfRotateOptions) => {
      const spinner = output.spinner('Rotating API key...').start();

      try {
        const result = await client.rotateApiKeySelf(options.name);
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
          'Days Until Expiry': result.expiresInDays,
          'Rotation Count': result.apiKey.rotation_count,
        });
      } catch (err) {
        spinner.fail('Failed to rotate API key');
        output.error(err instanceof Error ? err.message : String(err));
        console.log('\nNote: This command only works when authenticated via API key (X-API-Key header).');
        process.exit(1);
      }
    });
}
