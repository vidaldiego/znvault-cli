// Path: src/commands/agent/token/list.ts

/**
 * Token list command - list registration tokens for a managed key
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { TokenListOptions, RegistrationTokenListResponse } from '../types.js';
import { formatRelativeTime } from '../helpers.js';

export function registerTokenListCommand(parentCmd: Command): void {
  parentCmd
    .command('list [managed-key]')
    .description('List registration tokens for a managed key')
    .option('-k, --managed-key <name>', 'Name of the managed key (deprecated, use positional argument)')
    .option('--include-used', 'Include already-used tokens')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (managedKeyArg: string | undefined, options: TokenListOptions) => {
      // Support both positional argument and -k flag for backwards compatibility
      const managedKey = managedKeyArg || options.managedKey;

      if (!managedKey) {
        output.error('Managed key name is required');
        console.log('Usage: znvault agent token list <managed-key>');
        console.log('   or: znvault agent token list -k <managed-key> (deprecated)');
        process.exit(1);
      }

      const spinner = ora('Fetching registration tokens...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) params.set('tenantId', options.tenant);
        if (options.includeUsed) params.set('includeUsed', 'true');

        const query = params.toString();
        const response = await mode.apiGet<RegistrationTokenListResponse>(
          `/auth/api-keys/managed/${encodeURIComponent(managedKey)}/registration-tokens${query ? `?${query}` : ''}`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.tokens.length === 0) {
          console.log('No registration tokens found');
          return;
        }

        console.log(`Registration tokens for ${managedKey}:`);
        console.log();

        output.table(
          ['Prefix', 'Status', 'Created', 'Expires', 'Description'],
          response.tokens.map(t => [
            t.prefix,
            t.status === 'active' ? '● active' :
              t.status === 'used' ? '○ used' :
              t.status === 'expired' ? '○ expired' : '○ revoked',
            formatRelativeTime(t.createdAt),
            formatRelativeTime(t.expiresAt),
            t.description?.substring(0, 30) ?? '-',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch registration tokens');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
