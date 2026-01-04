// Path: znvault-cli/src/commands/backup.ts
// CLI commands for backup management

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface Backup {
  id: string;
  filename: string;
  storageIdentifier: string;
  storageType: 'local' | 's3';
  status: 'pending' | 'completed' | 'failed' | 'verified';
  dbSizeBytes: number;
  backupSizeBytes: number;
  encrypted: boolean;
  checksum?: string;
  initiatedBy: 'scheduled' | 'manual';
  verifiedAt?: string;
  metadata?: {
    duration?: number;
    compressionRatio?: number;
  };
  createdAt: string;
  completedAt?: string;
}

interface BackupListResponse {
  items: Backup[];
  total: number;
  page: number;
  pageSize: number;
}

interface BackupStats {
  totalBackups: number;
  totalSizeBytes: number;
  lastBackup?: string;
  lastSuccessful?: string;
  verifiedCount: number;
  failedCount: number;
}

interface BackupConfig {
  enabled: boolean;
  schedule?: string;
  retention?: {
    maxCount?: number;
    maxAgeDays?: number;
  };
  storage?: {
    type: 'local' | 's3';
    path?: string;
    bucket?: string;
    prefix?: string;
  };
}

interface BackupHealth {
  healthy: boolean;
  lastBackupAge?: number;
  lastBackupStatus?: string;
  storageAccessible: boolean;
  warnings?: string[];
}

interface ListOptions {
  status?: string;
  limit?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface ConfigOptions {
  enabled?: boolean;
  schedule?: string;
  maxCount?: string;
  maxAgeDays?: string;
  json?: boolean;
}

interface DeleteOptions {
  force?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'Pending',
    'completed': 'Completed',
    'failed': 'Failed',
    'verified': 'Verified',
  };
  return statusMap[status] || status;
}

function formatAge(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  return 'Just now';
}

// ============================================================================
// Command Implementations
// ============================================================================

async function listBackups(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching backups...').start();

  try {
    const query: Record<string, string | undefined> = {};
    if (options.status) query.status = options.status;
    if (options.limit) query.limit = options.limit;

    const response = await client.get<BackupListResponse>('/v1/admin/backups?' + new URLSearchParams(query as Record<string, string>).toString());
    spinner.stop();

    if (options.json) {
      output.json(response.items);
      return;
    }

    if (response.items.length === 0) {
      output.info('No backups found');
      return;
    }

    const table = new Table({
      head: ['ID', 'Status', 'Size', 'Type', 'Initiated', 'Created', 'Duration'],
      colWidths: [38, 12, 12, 12, 12, 20, 10],
    });

    for (const backup of response.items) {
      table.push([
        backup.id,
        formatStatus(backup.status),
        formatBytes(backup.backupSizeBytes),
        backup.storageType,
        backup.initiatedBy,
        formatAge(backup.createdAt),
        formatDuration(backup.metadata?.duration),
      ]);
    }

    console.log(table.toString());
    output.info(`Total: ${response.total} backup(s)`);
  } catch (error) {
    spinner.fail('Failed to list backups');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getBackup(id: string, options: GetOptions): Promise<void> {
  const spinner = ora('Fetching backup...').start();

  try {
    const backup = await client.get<Backup>(`/v1/admin/backups/${id}`);
    spinner.stop();

    if (options.json) {
      output.json(backup);
      return;
    }

    const table = new Table({
      colWidths: [20, 50],
    });

    table.push(
      ['ID', backup.id],
      ['Filename', backup.filename],
      ['Status', formatStatus(backup.status)],
      ['Storage Type', backup.storageType],
      ['Storage ID', backup.storageIdentifier],
      ['DB Size', formatBytes(backup.dbSizeBytes)],
      ['Backup Size', formatBytes(backup.backupSizeBytes)],
      ['Compression', backup.metadata?.compressionRatio ? `${(backup.metadata.compressionRatio * 100).toFixed(1)}%` : '-'],
      ['Encrypted', backup.encrypted ? 'Yes' : 'No'],
      ['Checksum', backup.checksum || '-'],
      ['Initiated By', backup.initiatedBy],
      ['Created', formatDate(backup.createdAt)],
      ['Completed', formatDate(backup.completedAt)],
      ['Duration', formatDuration(backup.metadata?.duration)],
    );

    if (backup.verifiedAt) {
      table.push(['Verified At', formatDate(backup.verifiedAt)]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to get backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function createBackup(): Promise<void> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Create a new backup now?',
      default: true,
    },
  ]);

  if (!confirm) {
    output.info('Backup cancelled');
    return;
  }

  const spinner = ora('Creating backup...').start();

  try {
    const result = await client.post<{ message: string; backup: Backup }>('/v1/admin/backups', {});
    spinner.stop();

    output.success('Backup created successfully!');
    console.log(`  ID:       ${result.backup.id}`);
    console.log(`  Filename: ${result.backup.filename}`);
    console.log(`  Size:     ${formatBytes(result.backup.backupSizeBytes)}`);
    console.log(`  Duration: ${formatDuration(result.backup.metadata?.duration)}`);
  } catch (error) {
    spinner.fail('Failed to create backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function verifyBackup(id: string): Promise<void> {
  const spinner = ora('Verifying backup...').start();

  try {
    const result = await client.post<{ valid: boolean; checksum: string; integrityCheck: string; message: string }>(`/v1/admin/backups/${id}/verify`, {});
    spinner.stop();

    if (result.valid) {
      output.success('Backup verification passed!');
      console.log(`  Checksum:  ${result.checksum}`);
      console.log(`  Integrity: ${result.integrityCheck}`);
    } else {
      output.error('Backup verification failed!');
      console.log(`  Message: ${result.message}`);
    }
  } catch (error) {
    spinner.fail('Failed to verify backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function deleteBackup(id: string, options: DeleteOptions): Promise<void> {
  if (!options.force) {
    const spinner = ora('Fetching backup...').start();
    try {
      const backup = await client.get<Backup>(`/v1/admin/backups/${id}`);
      spinner.stop();

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete backup "${backup.filename}" (${formatBytes(backup.backupSizeBytes)})? This cannot be undone.`,
          default: false,
        },
      ]);

      if (!confirm) {
        output.info('Deletion cancelled');
        return;
      }
    } catch (error) {
      spinner.fail('Failed to fetch backup');
      output.error((error as Error).message);
      process.exit(1);
    }
  }

  const deleteSpinner = ora('Deleting backup...').start();

  try {
    await client.delete(`/v1/admin/backups/${id}`);
    deleteSpinner.stop();
    output.success('Backup deleted successfully');
  } catch (error) {
    deleteSpinner.fail('Failed to delete backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function showStats(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching backup stats...').start();

  try {
    const stats = await client.get<BackupStats>('/v1/admin/backups/stats');
    spinner.stop();

    if (options.json) {
      output.json(stats);
      return;
    }

    const table = new Table({
      colWidths: [25, 40],
    });

    table.push(
      ['Total Backups', String(stats.totalBackups)],
      ['Total Size', formatBytes(stats.totalSizeBytes)],
      ['Last Backup', formatDate(stats.lastBackup)],
      ['Last Successful', formatDate(stats.lastSuccessful)],
      ['Verified Count', String(stats.verifiedCount)],
      ['Failed Count', String(stats.failedCount)],
    );

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch stats');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function showHealth(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Checking backup health...').start();

  try {
    const health = await client.get<BackupHealth>('/v1/admin/backups/health');
    spinner.stop();

    if (options.json) {
      output.json(health);
      return;
    }

    if (health.healthy) {
      output.success('Backup system is healthy');
    } else {
      output.warn('Backup system has issues');
    }

    console.log(`  Last Backup Age:    ${health.lastBackupAge ? `${health.lastBackupAge}h` : 'N/A'}`);
    console.log(`  Last Backup Status: ${health.lastBackupStatus || 'N/A'}`);
    console.log(`  Storage Accessible: ${health.storageAccessible ? 'Yes' : 'No'}`);

    if (health.warnings && health.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of health.warnings) {
        console.log(`  - ${warning}`);
      }
    }
  } catch (error) {
    spinner.fail('Failed to check health');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function showConfig(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching backup config...').start();

  try {
    const config = await client.get<BackupConfig>('/v1/admin/backups/config');
    spinner.stop();

    if (options.json) {
      output.json(config);
      return;
    }

    const table = new Table({
      colWidths: [25, 45],
    });

    table.push(
      ['Enabled', config.enabled ? 'Yes' : 'No'],
      ['Schedule', config.schedule || 'Not configured'],
      ['Max Count', config.retention?.maxCount?.toString() || 'Unlimited'],
      ['Max Age (days)', config.retention?.maxAgeDays?.toString() || 'Unlimited'],
      ['Storage Type', config.storage?.type || 'local'],
    );

    if (config.storage?.type === 'local') {
      table.push(['Storage Path', config.storage.path || '-']);
    } else if (config.storage?.type === 's3') {
      table.push(['S3 Bucket', config.storage.bucket || '-']);
      table.push(['S3 Prefix', config.storage.prefix || '-']);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch config');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function updateConfig(options: ConfigOptions): Promise<void> {
  const body: Record<string, unknown> = {};

  if (options.enabled !== undefined) body.enabled = options.enabled;
  if (options.schedule) body.schedule = options.schedule;
  if (options.maxCount || options.maxAgeDays) {
    body.retention = {};
    if (options.maxCount) (body.retention as Record<string, number>).maxCount = parseInt(options.maxCount, 10);
    if (options.maxAgeDays) (body.retention as Record<string, number>).maxAgeDays = parseInt(options.maxAgeDays, 10);
  }

  if (Object.keys(body).length === 0) {
    output.info('No changes specified');
    return;
  }

  const spinner = ora('Updating backup config...').start();

  try {
    const result = await client.patch<BackupConfig>('/v1/admin/backups/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Backup configuration updated');
  } catch (error) {
    spinner.fail('Failed to update config');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerBackupCommands(program: Command): void {
  const backup = program
    .command('backup')
    .description('Backup management');

  // List backups
  backup
    .command('list')
    .description('List all backups')
    .option('--status <status>', 'Filter by status (pending, completed, failed, verified)')
    .option('--limit <n>', 'Maximum number of backups to list')
    .option('--json', 'Output as JSON')
    .action(listBackups);

  // Get backup
  backup
    .command('get <id>')
    .description('Get backup details')
    .option('--json', 'Output as JSON')
    .action(getBackup);

  // Create backup
  backup
    .command('create')
    .description('Create a new backup')
    .action(createBackup);

  // Verify backup
  backup
    .command('verify <id>')
    .description('Verify backup integrity')
    .action(verifyBackup);

  // Delete backup
  backup
    .command('delete <id>')
    .description('Delete a backup')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteBackup);

  // Show stats
  backup
    .command('stats')
    .description('Show backup statistics')
    .option('--json', 'Output as JSON')
    .action(showStats);

  // Show health
  backup
    .command('health')
    .description('Check backup system health')
    .option('--json', 'Output as JSON')
    .action(showHealth);

  // Show config
  backup
    .command('config')
    .description('Show backup configuration')
    .option('--json', 'Output as JSON')
    .action(showConfig);

  // Update config
  backup
    .command('config-update')
    .description('Update backup configuration')
    .option('--enabled', 'Enable automatic backups')
    .option('--no-enabled', 'Disable automatic backups')
    .option('--schedule <cron>', 'Backup schedule (cron expression)')
    .option('--max-count <n>', 'Maximum number of backups to retain')
    .option('--max-age-days <n>', 'Maximum age of backups in days')
    .option('--json', 'Output as JSON')
    .action(updateConfig);
}
