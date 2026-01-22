// Path: src/commands/agent/token/revoke.ts

/**
 * Token revoke command - revoke a registration token
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { TokenRevokeOptions } from '../types.js';
import { confirmAction } from '../helpers.js';

export function registerTokenRevokeCommand(parentCmd: Command): void {
  parentCmd
    .command('revoke <token-id>')
    .description('Revoke a registration token (prevents future use)')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (tokenId: string, options: TokenRevokeOptions) => {
      if (!options.yes) {
        const confirmed = await confirmAction(`Revoke token ${tokenId}? This cannot be undone.`);
        if (!confirmed) {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Revoking registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        await mode.apiDelete(
          `/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens/${encodeURIComponent(tokenId)}${tenantQuery}`
        );

        spinner.succeed('Registration token revoked');
      } catch (err) {
        spinner.fail('Failed to revoke registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
