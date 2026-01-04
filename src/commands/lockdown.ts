import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

interface LockdownStatusOptions {
  json?: boolean;
}

interface LockdownTriggerOptions {
  yes?: boolean;
}

interface LockdownClearOptions {
  yes?: boolean;
}

interface LockdownHistoryOptions {
  limit: string;
  json?: boolean;
}

interface LockdownThreatsOptions {
  category?: string;
  since?: string;
  limit: string;
  json?: boolean;
}

export function registerLockdownCommands(program: Command): void {
  const lockdown = program
    .command('lockdown')
    .description('Lockdown and breach detection commands');

  // Lockdown status
  lockdown
    .command('status')
    .description('Show current lockdown status')
    .option('--json', 'Output as JSON')
    .action(async (options: LockdownStatusOptions) => {
      const spinner = ora('Getting lockdown status...').start();

      try {
        const status = await mode.getLockdownStatus();
        spinner.stop();

        if (options.json) {
          output.json(status);
          return;
        }

        output.section('Lockdown Status');

        const statusDisplay = {
          'Scope': status.scope,
          'Status': output.formatStatus(status.status),
          'Tenant': status.tenantId ?? 'N/A (System)',
          'Reason': status.reason ?? '-',
          'Triggered At': status.triggeredAt ? output.formatDate(status.triggeredAt) : '-',
          'Triggered By': status.triggeredBy ?? '-',
          'Escalation Count': status.escalationCount,
        };

        output.keyValue(statusDisplay);

        if (status.metrics) {
          output.section('Threat Metrics');
          output.keyValue({
            'Auth Failures': status.metrics.authFailures,
            'API Abuse': status.metrics.apiAbuse,
            'Permission Violations': status.metrics.permissionViolations,
          });
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get lockdown status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Trigger lockdown (API only)
  lockdown
    .command('trigger <level> <reason>')
    .description('Manually trigger a lockdown (level 1-4)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (level: string, reason: string, options: LockdownTriggerOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Lockdown trigger requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const levelNum = parseInt(level, 10);
      if (isNaN(levelNum) || levelNum < 1 || levelNum > 4) {
        output.error('Level must be between 1 and 4');
        output.info('  Level 1: ALERT - Increased monitoring');
        output.info('  Level 2: RESTRICT - Limited functionality');
        output.info('  Level 3: LOCKDOWN - Most operations blocked');
        output.info('  Level 4: PANIC - Full system lockdown');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const levelNames = ['', 'ALERT', 'RESTRICT', 'LOCKDOWN', 'PANIC'];
          const confirmed = await promptConfirm(
            `Are you sure you want to trigger ${levelNames[levelNum]} (level ${levelNum})?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Triggering lockdown...').start();

        try {
          const result = await client.triggerLockdown(levelNum as 1 | 2 | 3 | 4, reason);
          spinner.succeed('Lockdown triggered');
          output.keyValue({
            'Success': result.success,
            'New Status': result.status,
          });
        } catch (err) {
          spinner.fail('Failed to trigger lockdown');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Clear lockdown (API only)
  lockdown
    .command('clear <reason>')
    .description('Clear the current lockdown')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (reason: string, options: LockdownClearOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Lockdown clear requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            'Are you sure you want to clear the lockdown?'
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Clearing lockdown...').start();

        try {
          const result = await client.clearLockdown(reason);
          spinner.succeed('Lockdown cleared');
          output.keyValue({
            'Success': result.success,
            'Previous Status': result.previousStatus,
          });
        } catch (err) {
          spinner.fail('Failed to clear lockdown');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Lockdown history
  lockdown
    .command('history')
    .description('Show lockdown history')
    .option('--limit <number>', 'Number of entries to show', '50')
    .option('--json', 'Output as JSON')
    .action(async (options: LockdownHistoryOptions) => {
      const spinner = ora('Fetching lockdown history...').start();

      try {
        const history = await mode.getLockdownHistory(parseInt(options.limit, 10));
        spinner.stop();

        if (options.json) {
          output.json(history);
          return;
        }

        if (history.length === 0) {
          output.info('No lockdown history found');
          return;
        }

        output.table(
          ['Time', 'Previous', 'New', 'Reason', 'By'],
          history.map(h => [
            output.formatRelativeTime(h.ts),
            h.previousStatus,
            h.newStatus,
            h.transitionReason.substring(0, 40),
            h.changedBySystem ? 'System' : (h.changedByUserId?.substring(0, 8) ?? '-'),
          ])
        );

        output.info(`Showing ${history.length} entries`);
      } catch (err) {
        spinner.fail('Failed to get lockdown history');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // List threats
  lockdown
    .command('threats')
    .description('List recent threat events')
    .option('--category <cat>', 'Filter by category')
    .option('--since <date>', 'Show threats since date (ISO format)')
    .option('--limit <number>', 'Number of entries to show', '100')
    .option('--json', 'Output as JSON')
    .action(async (options: LockdownThreatsOptions) => {
      const spinner = ora('Fetching threats...').start();

      try {
        const threats = await mode.getThreats({
          category: options.category,
          since: options.since,
          limit: parseInt(options.limit, 10),
        });
        spinner.stop();

        if (options.json) {
          output.json(threats);
          return;
        }

        if (threats.length === 0) {
          output.info('No threats found');
          return;
        }

        output.table(
          ['Time', 'Category', 'Signal', 'IP', 'Endpoint', 'Level', 'Escalated'],
          threats.map(t => [
            output.formatRelativeTime(t.ts),
            t.category,
            t.signal.substring(0, 20),
            t.ip,
            t.endpoint.substring(0, 25),
            t.suggestedLevel,
            t.escalated,
          ])
        );

        output.info(`Showing ${threats.length} threats`);

        // Show category summary
        const categories = threats.reduce<Record<string, number>>((acc, t) => {
          acc[t.category] = (acc[t.category] ?? 0) + 1;
          return acc;
        }, {});

        if (Object.keys(categories).length > 1) {
          output.section('By Category');
          output.keyValue(categories);
        }
      } catch (err) {
        spinner.fail('Failed to get threats');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
