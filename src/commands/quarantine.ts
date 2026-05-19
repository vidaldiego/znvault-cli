// Path: src/commands/quarantine.ts

import type { Command } from 'commander';

import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import { formatTtl as formatDuration } from '../lib/format-helpers.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../lib/command-context.js';

interface ListOptions {
  status?: 'active' | 'released' | 'expired';
  tenant?: string;
  includeExpired?: boolean;
  limit: string;
  json?: boolean;
}

interface ReleaseOptions {
  yes?: boolean;
  json?: boolean;
}

interface HistoryOptions {
  limit: string;
  tenant?: string;
  json?: boolean;
}

interface StatsOptions {
  tenant?: string;
  json?: boolean;
}

interface ConfigOptions {
  tenant?: string;
  json?: boolean;
}

interface SetConfigOptions {
  tenant?: string;
  yes?: boolean;
  json?: boolean;
}

function formatBackoffLevel(level: number): string {
  const labels = ['', '1m', '5m', '30m', '4h', '24h'];
  return labels[level] ?? `Level ${level}`;
}

export function registerQuarantineCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  withRegisterContext(ctx, () => { registerQuarantineCommandsInner(parent, ctx); });
}

function registerQuarantineCommandsInner(parent: Command, ctx: 'tenant' | 'superadmin'): void {
  const asSuperadmin = ctx === 'superadmin';
  // Helper: only register --tenant in superadmin context
  const t = (cmd: Command, desc: string, shortFlag = true): Command =>
    asSuperadmin
      ? cmd.option(shortFlag ? '-t, --tenant <tenant>' : '--tenant <tenant>', desc)
      : cmd;
  // Build the scope object used by every quarantine client call. In tenant
  // mode this stays `undefined` (routes to `/v1/quarantine/*`). In
  // superadmin mode it always routes to `/v1/superadmin/quarantine/*`,
  // optionally narrowed by --tenant.
  const scope = (tenant?: string): { asSuperadmin: boolean; tenantId?: string } | undefined =>
    asSuperadmin ? { asSuperadmin: true, tenantId: tenant } : undefined;

  const quarantine = parent
    .command('quarantine')
    .description(
      ctx === 'superadmin'
        ? 'IP quarantine management (cross-tenant)'
        : 'IP quarantine management commands'
    );

  // List quarantined IPs
  {
    const listCmd = quarantine
      .command('list')
      .description('List quarantined IPs')
      .option('-s, --status <status>', 'Filter by status (active, released, expired)');
    t(listCmd, 'Filter by tenant ID');
    listCmd
      .option('--include-expired', 'Include expired quarantines')
    .option('--limit <number>', 'Number of entries to show', '50')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = output.spinner('Fetching quarantined IPs...').start();

      try {
        const result = await client.listQuarantines({
          status: options.status,
          tenantId: options.tenant,
          includeExpired: options.includeExpired,
          limit: parseInt(options.limit, 10),
          asSuperadmin,
        });
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.info('No quarantined IPs found');
          return;
        }

        output.table(
          ['IP Address', 'Status', 'Failures', 'Level', 'Blocked Until', 'Tenant', 'Reason'],
          result.items.map(q => [
            q.ipAddress,
            output.formatStatus(q.status),
            q.failureCount,
            formatBackoffLevel(q.backoffLevel),
            q.status === 'active' ? output.formatRelativeTime(q.blockedUntil) : '-',
            q.tenantId ?? '-',
            q.reason.substring(0, 30),
          ])
        );

        // The server returns {items, total} for quarantine list (legacy shape)
        // rather than the standard {items, pagination:{total,…}} envelope used
        // elsewhere. Accept either to stay robust against server-side cleanups.
        const total =
          (result as unknown as {pagination?: {total?: number}}).pagination?.total ??
          (result as unknown as {total?: number}).total ??
          result.items.length;
        output.info(`Showing ${result.items.length} of ${total} quarantines`);
      } catch (err) {
        spinner.fail('Failed to list quarantines');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Get quarantine details
  {
    const getCmd = quarantine
      .command('get <id>')
      .description('Get quarantine details by ID');
    t(getCmd, 'Tenant ID (superadmin only, cross-tenant)');
    getCmd
      .option('--json', 'Output as JSON')
      .action(async (id: string, options: { json?: boolean; tenant?: string }) => {
      const spinner = output.spinner('Fetching quarantine details...').start();

      try {
        const q = await client.getQuarantine(id, scope(options.tenant));
        spinner.stop();

        if (options.json) {
          output.json(q);
          return;
        }

        output.section('Quarantine Details');
        output.keyValue({
          'ID': q.id,
          'IP Address': q.ipAddress,
          'Status': output.formatStatus(q.status),
          'Tenant': q.tenantId ?? 'N/A (System)',
          'Failure Count': q.failureCount,
          'Backoff Level': `${q.backoffLevel} (${formatBackoffLevel(q.backoffLevel)})`,
          'Blocked Until': q.status === 'active' ? output.formatDate(q.blockedUntil) : '-',
          'Reason': q.reason,
          'First Failure': output.formatDate(q.firstFailureAt),
          'Last Failure': output.formatDate(q.lastFailureAt),
        });

        if (q.lastFailurePath) {
          output.section('Last Request');
          output.keyValue({
            'Path': q.lastFailurePath,
            'Method': q.lastFailureMethod ?? '-',
            'User Agent': q.userAgent?.substring(0, 50) ?? '-',
            'API Key ID': q.apiKeyId ?? '-',
            'Agent ID': q.agentId ?? '-',
          });
        }

        if (q.releasedAt) {
          output.section('Release Info');
          output.keyValue({
            'Released At': output.formatDate(q.releasedAt),
            'Released By': q.releasedBy ?? '-',
            'Release Reason': q.releaseReason ?? '-',
          });
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get quarantine');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Release a quarantine by ID
  {
    const releaseCmd = quarantine
      .command('release <id> <reason>')
      .description('Release a quarantine by ID');
    t(releaseCmd, 'Tenant ID (superadmin only, cross-tenant)');
    releaseCmd
      .option('-y, --yes', 'Skip confirmation')
      .option('--json', 'Output as JSON')
      .action(async (id: string, reason: string, options: ReleaseOptions & { tenant?: string }) => {
      try {
        // Get quarantine info first
        const q = await client.getQuarantine(id, scope(options.tenant));

        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to release quarantine for IP ${q.ipAddress}?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = output.spinner('Releasing quarantine...').start();

        try {
          const result = await client.releaseQuarantine(id, reason, scope(options.tenant));
          spinner.succeed('Quarantine released');

          if (options.json) {
            output.json(result);
            return;
          }

          output.success(result.message);
        } catch (err) {
          spinner.fail('Failed to release quarantine');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Release all quarantines for an IP
  {
    const releaseIpCmd = quarantine
      .command('release-ip <ip> <reason>')
      .description('Release all quarantines for an IP address');
    t(releaseIpCmd, 'Filter by tenant ID');
    releaseIpCmd
      .option('-y, --yes', 'Skip confirmation')
      .option('--json', 'Output as JSON')
      .action(async (ip: string, reason: string, options: ReleaseOptions & { tenant?: string }) => {
      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to release all quarantines for IP ${ip}?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = output.spinner('Releasing IP quarantines...').start();

        try {
          const result = await client.releaseQuarantineIp(ip, reason, scope(options.tenant));
          spinner.succeed('Quarantine(s) released');

          if (options.json) {
            output.json(result);
            return;
          }

          output.success(result.message);
          if (result.releasedCount !== undefined) {
            output.info(`Released ${result.releasedCount} quarantine(s)`);
          }
        } catch (err) {
          spinner.fail('Failed to release IP quarantines');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Get failure history for an IP
  {
    const historyCmd = quarantine
      .command('history <ip>')
      .description('Get failure history for an IP address');
    t(historyCmd, 'Filter by tenant ID');
    historyCmd
      .option('--limit <number>', 'Number of entries to show', '100')
      .option('--json', 'Output as JSON')
      .action(async (ip: string, options: HistoryOptions) => {
      const spinner = output.spinner('Fetching failure history...').start();

      try {
        const result = await client.getQuarantineHistory(ip, {
          limit: parseInt(options.limit, 10),
          tenantId: options.tenant,
          asSuperadmin,
        });
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.failures.length === 0) {
          output.info(`No failure history found for IP ${ip}`);
          return;
        }

        output.section(`Failure History for ${ip}`);

        output.table(
          ['Time', 'Type', 'Path', 'Method', 'Username', 'API Key', 'Quarantine'],
          result.failures.map(f => [
            output.formatRelativeTime(f.ts),
            f.failureType,
            f.path?.substring(0, 25) ?? '-',
            f.method ?? '-',
            f.username ?? '-',
            f.apiKeyPrefix ?? '-',
            f.quarantineId ? 'Yes' : '-',
          ])
        );

        output.info(`Showing ${result.failures.length} entries`);
      } catch (err) {
        spinner.fail('Failed to get failure history');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Get quarantine statistics
  {
    const statsCmd = quarantine
      .command('stats')
      .description('Get quarantine statistics');
    t(statsCmd, 'Filter by tenant ID');
    statsCmd
      .option('--json', 'Output as JSON')
      .action(async (options: StatsOptions) => {
      const spinner = output.spinner('Fetching statistics...').start();

      try {
        const stats = await client.getQuarantineStats(scope(options.tenant));
        spinner.stop();

        if (options.json) {
          output.json(stats);
          return;
        }

        output.section('Quarantine Statistics');
        output.keyValue({
          'Active Quarantines': stats.activeQuarantines,
          'Quarantines (24h)': stats.totalQuarantines24h,
          'Unique IPs (24h)': stats.uniqueIpsQuarantined24h,
          'Failures (1h)': stats.failuresLast1h,
          'Failures (24h)': stats.failuresLast24h,
        });

        if (stats.topFailingIps.length > 0) {
          output.section('Top Failing IPs (24h)');
          output.table(
            ['IP Address', 'Failures'],
            stats.topFailingIps.map(ip => [ip.ip, ip.count])
          );
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get statistics');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Get quarantine configuration
  //
  // Semantics:
  //   - Tenant context (top-level `quarantine config`): operates on caller's
  //     own tenant (via JWT).
  //   - Superadmin context without --tenant: operates on system (null-tenant) config.
  //   - Superadmin context with --tenant X: operates on tenant X's config.
  {
    const configCmd = quarantine
      .command('config')
      .description('Get quarantine configuration');
    t(configCmd, 'Tenant ID (omit for system config)');
    configCmd
      .option('--json', 'Output as JSON')
      .action(async (options: ConfigOptions) => {
      const spinner = output.spinner('Fetching configuration...').start();

      try {
        const config = await client.getQuarantineConfig(scope(options.tenant));
        spinner.stop();

        if (options.json) {
          output.json(config);
          return;
        }

        output.section('Quarantine Configuration');
        output.keyValue({
          'Enabled': config.enabled ? 'Yes' : 'No',
          'Failures Before Quarantine': config.failuresBeforeQuarantine,
          'Lockdown Threshold (IPs)': config.lockdownThresholdIps,
          'Lockdown Window': formatDuration(config.lockdownThresholdWindowSeconds),
          'Auto-Expire After': formatDuration(config.autoExpireAfterSeconds),
        });

        output.section('Backoff Durations');
        output.keyValue({
          'Level 1': formatDuration(config.backoffLevel1Seconds),
          'Level 2': formatDuration(config.backoffLevel2Seconds),
          'Level 3': formatDuration(config.backoffLevel3Seconds),
          'Level 4': formatDuration(config.backoffLevel4Seconds),
          'Level 5': formatDuration(config.backoffLevel5Seconds),
        });

        if (config.ipAllowlist.length > 0) {
          output.section('IP Allowlist');
          config.ipAllowlist.forEach(ip => output.info(`  ${ip}`));
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }

  // Set quarantine configuration
  {
    const setConfigCmd = quarantine
      .command('set-config')
      .description('Update quarantine configuration');
    t(setConfigCmd, 'Tenant ID (omit for system config)');
    setConfigCmd
      .option('--enabled <bool>', 'Enable/disable quarantine')
    .option('--failures <num>', 'Failures before quarantine')
      .option('--lockdown-ips <num>', 'Number of IPs to trigger lockdown')
      .option('--lockdown-window <sec>', 'Lockdown threshold window (seconds)')
      .option('--level1 <sec>', 'Level 1 backoff (seconds)')
      .option('--level2 <sec>', 'Level 2 backoff (seconds)')
      .option('--level3 <sec>', 'Level 3 backoff (seconds)')
      .option('--level4 <sec>', 'Level 4 backoff (seconds)')
      .option('--level5 <sec>', 'Level 5 backoff (seconds)')
      .option('--auto-expire <sec>', 'Auto-expire after (seconds)')
      .option('-y, --yes', 'Skip confirmation')
      .option('--json', 'Output as JSON')
      .action(async (options: SetConfigOptions & Record<string, string | undefined>) => {
      const updates: Record<string, unknown> = {};

      if (options.enabled !== undefined) {
        updates.enabled = options.enabled === 'true';
      }
      if (options.failures !== undefined) {
        updates.failuresBeforeQuarantine = parseInt(options.failures, 10);
      }
      if (options.lockdownIps !== undefined) {
        updates.lockdownThresholdIps = parseInt(options.lockdownIps, 10);
      }
      if (options.lockdownWindow !== undefined) {
        updates.lockdownThresholdWindowSeconds = parseInt(options.lockdownWindow, 10);
      }
      if (options.level1 !== undefined) {
        updates.backoffLevel1Seconds = parseInt(options.level1, 10);
      }
      if (options.level2 !== undefined) {
        updates.backoffLevel2Seconds = parseInt(options.level2, 10);
      }
      if (options.level3 !== undefined) {
        updates.backoffLevel3Seconds = parseInt(options.level3, 10);
      }
      if (options.level4 !== undefined) {
        updates.backoffLevel4Seconds = parseInt(options.level4, 10);
      }
      if (options.level5 !== undefined) {
        updates.backoffLevel5Seconds = parseInt(options.level5, 10);
      }
      if (options.autoExpire !== undefined) {
        updates.autoExpireAfterSeconds = parseInt(options.autoExpire, 10);
      }

      if (Object.keys(updates).length === 0) {
        output.error('No configuration options provided');
        output.info('Use --help to see available options');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          output.section('Configuration Changes');
          output.keyValue(updates as Record<string, string | number | boolean>);

          const confirmed = await promptConfirm('Apply these changes?');
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = output.spinner('Updating configuration...').start();

        try {
          const result = await client.updateQuarantineConfig(updates, scope(options.tenant));
          spinner.succeed('Configuration updated');

          if (options.json) {
            output.json(result);
            return;
          }

          output.success('Quarantine configuration updated successfully');
        } catch (err) {
          spinner.fail('Failed to update configuration');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
  }
}
