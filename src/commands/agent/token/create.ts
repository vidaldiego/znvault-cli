// Path: src/commands/agent/token/create.ts

/**
 * Token create command - create a one-time registration token
 */

import type { Command } from 'commander';

import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { TokenCreateOptions, RegistrationTokenCreateResponse } from '../types.js';

export function registerTokenCreateCommand(parentCmd: Command): void {
  parentCmd
    .command('create [managed-key]')
    .description('Create a one-time registration token for managed key binding')
    .option('-k, --managed-key <name>', 'Name of the managed key (deprecated, use positional argument)')
    .option('-e, --expires <duration>', 'Token expiration (e.g., "1h", "24h")', '1h')
    .option('-d, --description <text>', 'Optional description for audit trail')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (managedKeyArg: string | undefined, options: TokenCreateOptions) => {
      // Support both positional argument and -k flag for backwards compatibility
      const managedKey = managedKeyArg || options.managedKey;

      if (!managedKey) {
        output.error('Managed key name is required');
        console.log('Usage: znvault agent token create <managed-key>');
        console.log('   or: znvault agent token create -k <managed-key> (deprecated)');
        process.exit(1);
      }

      const spinner = output.spinner('Creating registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        const response = await mode.apiPost<RegistrationTokenCreateResponse>(
          `/auth/api-keys/managed/${encodeURIComponent(managedKey)}/registration-tokens${tenantQuery}`,
          {
            expiresIn: options.expires,
            description: options.description,
          }
        );

        spinner.succeed('Registration token created');

        if (options.json) {
          output.json(response);
          return;
        }

        console.log();
        console.log('Token (save this - shown only once!):');
        console.log(`  ${response.token}`);
        console.log();
        console.log('Details:');
        console.log(`  ID: ${response.id}`);
        console.log(`  Prefix: ${response.prefix}`);
        console.log(`  Managed Key: ${response.managedKeyName}`);
        console.log(`  Tenant: ${response.tenantId}`);
        console.log(`  Expires: ${new Date(response.expiresAt).toLocaleString()}`);
        if (response.description) {
          console.log(`  Description: ${response.description}`);
        }
        console.log();
        console.log('Usage:');
        console.log(`  curl -sSL https://vault.example.com/agent/bootstrap.sh | ZNVAULT_TOKEN=${response.token} bash`);
        console.log();
        console.log('Or manually:');
        console.log(`  curl -X POST https://vault.example.com/agent/bootstrap \\`);
        console.log(`    -H "Content-Type: application/json" \\`);
        console.log(`    -d '{"token": "${response.token}"}'`);
      } catch (err) {
        spinner.fail('Failed to create registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
