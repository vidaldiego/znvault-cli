// Path: src/commands/apikey/create.ts

/**
 * API key create command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { CreateOptions, ApiKeyConditions } from './types.js';
import { formatDate, displayConditions, parseConditionsFromOptions } from './helpers.js';

export function registerCreateCommand(apiKeyCmd: Command): void {
  apiKeyCmd
    .command('create <name>')
    .description('Create a new API key with direct permissions')
    .option('-e, --expires <days>', 'Days until expiration (1-3650, default: 90)', '90')
    .option('-p, --permissions <perms>', 'Comma-separated permissions (required)')
    .option('-d, --description <desc>', 'Description')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('--time-range <range>', 'Time range restriction: "HH:MM-HH:MM [TIMEZONE]"')
    .option('--methods <methods>', 'Comma-separated allowed HTTP methods: GET,POST,etc')
    .option('--resources <ids>', 'Specific resource IDs (type:id,...): secrets:id1,certificates:id2')
    .option('--aliases <patterns>', 'Comma-separated alias patterns (glob): prod/*,api/*')
    .option('--tags <tags>', 'Required resource tags: key=value,key2=value2')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: CreateOptions) => {
      // Validate permissions
      if (!options.permissions) {
        output.error('--permissions is required. Use comma-separated permission strings.');
        output.info('Example: --permissions "secret:read:value,secret:list:values"');
        process.exit(1);
      }

      const permissions = options.permissions.split(',').map((p) => p.trim());

      const spinner = ora('Creating API key...').start();

      try {
        // Parse options
        const expiresInDays = parseInt(options.expires, 10);
        if (isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          spinner.fail('Invalid expiration');
          output.error('Expiration must be between 1 and 3650 days');
          process.exit(1);
        }

        let ipAllowlist: string[] | undefined;
        if (options.ip) {
          ipAllowlist = options.ip.split(',').map((ip) => ip.trim());
        }

        // Validate time range format
        if (options.timeRange) {
          const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/.exec(options.timeRange);
          if (!match) {
            spinner.fail('Invalid time range format');
            output.error('Use format: "HH:MM-HH:MM [TIMEZONE]"');
            output.info('Example: --time-range "09:00-17:00 America/New_York"');
            process.exit(1);
          }
        }

        // Parse conditions
        const conditions = parseConditionsFromOptions(options);

        // Add IP to conditions as well (for backward compatibility)
        if (ipAllowlist) {
          conditions.ip = ipAllowlist;
        }

        const result = await client.createApiKey({
          name,
          description: options.description,
          expiresInDays,
          permissions,
          ipAllowlist,
          conditions: Object.keys(conditions).length > 0 ? conditions : undefined,
          tenantId: options.tenant,
        });

        spinner.succeed('API key created');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n⚠️  IMPORTANT: Save this key now - it will not be shown again!\n');
        console.log('────────────────────────────────────────────────────────────────');
        console.log(`API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Status': result.apiKey.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled',
          'Tenant': result.apiKey.tenant_id,
          'Description': result.apiKey.description ?? 'None',
          'Expires': formatDate(result.apiKey.expires_at),
          'IP Allowlist': result.apiKey.ip_allowlist?.join(', ') ?? 'None',
        });

        if (result.apiKey.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.apiKey.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const apiKeyConditions = result.apiKey.conditions as ApiKeyConditions | undefined;
        if (apiKeyConditions && Object.keys(apiKeyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(apiKeyConditions);
        }
      } catch (err) {
        spinner.fail('Failed to create API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
