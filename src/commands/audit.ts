import { type Command } from 'commander';

import fs from 'node:fs';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
  type CommandContext,
} from '../lib/command-context.js';

interface AuditListOptions {
  user?: string;
  action?: string;
  days: string;
  limit: string;
  json?: boolean;
  tenant?: string;
}

interface AuditVerifyOptions {
  json?: boolean;
}

interface AuditExportOptions {
  format: 'json' | 'csv';
  days: string;
  output?: string;
  json?: boolean;
  tenant?: string;
}

export function registerAuditCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  withRegisterContext(ctx, () => { registerAuditCommandsInner(parent, ctx); });
}

function registerAuditCommandsInner(parent: Command, ctx: CommandContext): void {
  const asSuperadmin = ctx === 'superadmin';
  const audit = parent
    .command('audit')
    .description('Audit log commands');

  // List audit entries
  audit
    .command('list')
    .description('List audit log entries')
    .option('--user <username>', 'Filter by username')
    .option('--action <action>', 'Filter by action')
    .option('--days <number>', 'Show entries from last N days', '7')
    .option('--limit <number>', 'Number of entries to show', '100')
    .option('--tenant <id>', 'Tenant ID (superadmin cross-tenant)')
    .option('--json', 'Output as JSON')
    .action(async (options: AuditListOptions) => {
      const spinner = output.spinner('Fetching audit logs...').start();

      try {
        const days = parseInt(options.days, 10);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const entries = await mode.listAudit({
          user: options.user,
          action: options.action,
          startDate: startDate.toISOString(),
          limit: parseInt(options.limit, 10),
          tenantId: options.tenant,
          asSuperadmin,
        });
        spinner.stop();

        if (options.json) {
          output.json(entries);
          return;
        }

        if (entries.length === 0) {
          output.info('No audit entries found');
          return;
        }

        output.table(
          ['Time', 'User', 'Action', 'Resource', 'Status', 'IP'],
          entries.map(e => [
            output.formatRelativeTime(e.ts),
            e.clientCn || '-',
            e.action,
            (e.resource || '-').substring(0, 30),
            e.statusCode,
            e.ip ?? '-',
          ])
        );

        output.info(`Showing ${entries.length} entries`);

        // Show action summary
        const actions = entries.reduce<Record<string, number>>((acc, e) => {
          acc[e.action] = (acc[e.action] || 0) + 1;
          return acc;
        }, {});

        if (Object.keys(actions).length > 1) {
          output.section('By Action');
          output.keyValue(actions);
        }
      } catch (err) {
        spinner.fail('Failed to list audit entries');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Verify audit chain
  audit
    .command('verify')
    .description('Verify audit log chain integrity (HMAC)')
    .option('--json', 'Output as JSON')
    .action(async (options: AuditVerifyOptions) => {
      const spinner = output.spinner('Verifying audit chain...').start();

      try {
        const result = await mode.verifyAuditChain({ asSuperadmin });
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.valid) {
          output.success('Audit chain is valid');
          output.keyValue({
            'Total Entries': result.totalEntries,
            'Verified Entries': result.verifiedEntries,
          });
        } else {
          output.error('Audit chain integrity check FAILED');
          output.keyValue({
            'Total Entries': result.totalEntries,
            'Verified Entries': result.verifiedEntries,
            'First Broken Entry': result.firstBrokenEntry ?? '-',
            'Message': result.message,
          });
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Failed to verify audit chain');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Export audit logs (API only - requires authentication for export endpoint)
  audit
    .command('export')
    .description('Export audit logs')
    .option('--format <format>', 'Output format (json|csv)', 'json')
    .option('--days <number>', 'Export entries from last N days', '30')
    .option('--output <file>', 'Output file (default: stdout)')
    .option('--tenant <id>', 'Tenant ID (superadmin cross-tenant)')
    .option('--json', 'Output result as JSON')
    .action(async (options: AuditExportOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Audit export requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = output.spinner('Exporting audit logs...').start();

      try {
        const days = parseInt(options.days, 10);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const data = await client.exportAudit({
          format: options.format,
          startDate: startDate.toISOString(),
          tenantId: options.tenant,
          asSuperadmin,
        });
        spinner.stop();

        if (options.output) {
          fs.writeFileSync(options.output, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
          if (options.json) {
            output.json({ success: true, file: options.output, format: options.format });
          } else {
            output.success(`Exported to ${options.output}`);
          }
        } else {
          console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        }
      } catch (err) {
        spinner.fail('Failed to export audit logs');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
