// Path: src/commands/apikey/show.ts

/**
 * API key show command
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { APIKey } from '../../types/index.js';
import type { ShowOptions } from './types.js';
import { apiKeyAsSuperadmin, formatDate, getDaysUntilExpiry, displayConditions } from './helpers.js';

export function registerShowCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('show <id>')
    .description('Show API key details')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: ShowOptions, cmd: Command) => {
      const spinner = output.spinner('Fetching API key...').start();
      const asSuperadmin = apiKeyAsSuperadmin(cmd);

      try {
        // First try to get by ID directly
        let key: APIKey | undefined;
        try {
          key = await client.getApiKey(id, options.tenant, { asSuperadmin });
        } catch {
          // Fall back to list and search
          const result = await client.listApiKeys(options.tenant, { asSuperadmin });
          key = result.items.find(k => k.id === id || k.prefix === id || k.name === id);
        }

        if (!key) {
          spinner.fail('API key not found');
          output.error(`No API key found matching: ${id}`);
          process.exit(1);
        }

        spinner.stop();

        if (options.json) {
          output.json(key);
          return;
        }

        const daysLeft = getDaysUntilExpiry(key.expires_at);
        const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

        output.keyValue({
          'Key ID': key.id,
          'Name': key.name,
          'Prefix': key.prefix,
          'Status': statusIcon,
          'Tenant': key.tenant_id,
          'Description': key.description ?? 'None',
          'Created By': key.created_by_username ?? key.created_by ?? 'Unknown',
          'Created': formatDate(key.created_at),
          'Expires': formatDate(key.expires_at),
          'Days Until Expiry': daysLeft,
          'Last Used': key.last_used ? formatDate(key.last_used) : 'Never',
          'Rotation Count': key.rotation_count,
          'Last Rotation': key.last_rotation ? formatDate(key.last_rotation) : 'Never',
          'IP Allowlist': key.ip_allowlist?.join(', ') ?? 'None (any IP)',
        });

        if (key.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of key.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const keyConditions = key.conditions;
        if (keyConditions && Object.keys(keyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(keyConditions);
        }

        if (!key.enabled) {
          console.log('\n⚠️  This key is disabled and cannot be used for authentication.');
        } else if (daysLeft <= 7) {
          console.log('\n⚠️  This key is expiring soon! Consider rotating it.');
        }
      } catch (err) {
        spinner.fail('Failed to fetch API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
