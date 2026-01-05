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
  storageType: 'local' | 's3' | 'sftp';
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

interface S3Config {
  bucket?: string;
  region?: string;
  prefix?: string;
  endpoint?: string;
  hasCredentials?: boolean;
}

interface SftpConfig {
  host?: string;
  port?: number;
  username?: string;
  remotePath?: string;
  hasCredentials?: boolean;
}

interface LocalConfig {
  path?: string;
}

interface StorageConfig {
  type: 'local' | 's3' | 'sftp';
  local?: LocalConfig;
  s3?: S3Config;
  sftp?: SftpConfig;
}

interface EncryptionConfig {
  enabled: boolean;
  hasPassword?: boolean;
}

interface BackupConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: number;
  retentionCount: number;
  storage?: StorageConfig;
  encryption?: EncryptionConfig;
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
  interval?: string;
  retentionDays?: string;
  retentionCount?: string;
  json?: boolean;
}

interface S3StorageOptions {
  bucket: string;
  region?: string;
  prefix?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  json?: boolean;
}

interface LocalStorageOptions {
  path: string;
  json?: boolean;
}

interface EncryptionOptions {
  enable?: boolean;
  disable?: boolean;
  passwordFile?: string;
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

function formatInterval(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${ms}ms`;
}

function parseInterval(interval: string): number {
  // Support formats: 1h, 30m, 1h30m, 3600000 (ms)
  const regex = /^(?:(\d+)h)?(?:(\d+)m)?$/i;
  const match = regex.exec(interval);
  if (match !== null) {
    // Capture groups are undefined when not matched (runtime behavior)
    const hoursStr = match[1] as string | undefined;
    const minutesStr = match[2] as string | undefined;
    // Both groups are optional - at least one must be present for a valid interval
    if (hoursStr ?? minutesStr) {
      const hours = hoursStr ? parseInt(hoursStr, 10) : 0;
      const minutes = minutesStr ? parseInt(minutesStr, 10) : 0;
      return (hours * 60 + minutes) * 60 * 1000;
    }
  }
  // Try parsing as milliseconds
  const ms = parseInt(interval, 10);
  if (!isNaN(ms)) return ms;
  throw new Error('Invalid interval format. Use: 1h, 30m, 1h30m, or milliseconds');
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
      ['Checksum', backup.checksum ?? '-'],
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
    console.log(`  Last Backup Status: ${health.lastBackupStatus ?? 'N/A'}`);
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

    // General settings
    console.log('\n  GENERAL SETTINGS\n');
    const generalTable = new Table({
      colWidths: [25, 45],
      style: { head: [], border: [] },
    });

    generalTable.push(
      ['Enabled', config.enabled ? 'Yes' : 'No'],
      ['Interval', formatInterval(config.intervalMs)],
      ['Retention (days)', config.retentionDays.toString()],
      ['Retention (count)', config.retentionCount.toString()],
    );
    console.log(generalTable.toString());

    // Storage settings
    console.log('\n  STORAGE CONFIGURATION\n');
    const storageTable = new Table({
      colWidths: [25, 45],
      style: { head: [], border: [] },
    });

    const storageType = config.storage?.type ?? 'local';
    storageTable.push(['Type', storageType.toUpperCase()]);

    if (storageType === 'local') {
      storageTable.push(['Path', config.storage?.local?.path ?? 'data/backups']);
    } else if (storageType === 's3') {
      const s3 = config.storage?.s3;
      storageTable.push(['Bucket', s3?.bucket ?? '-']);
      storageTable.push(['Region', s3?.region ?? 'us-east-1']);
      storageTable.push(['Prefix', s3?.prefix ?? 'backups/']);
      if (s3?.endpoint) {
        storageTable.push(['Endpoint', s3.endpoint]);
      }
      storageTable.push(['Credentials', s3?.hasCredentials ? 'Configured' : 'Using IAM Role']);
    } else {
      // SFTP storage
      const sftp = config.storage?.sftp;
      storageTable.push(['Host', sftp?.host ?? '-']);
      storageTable.push(['Port', sftp?.port?.toString() ?? '22']);
      storageTable.push(['Username', sftp?.username ?? '-']);
      storageTable.push(['Remote Path', sftp?.remotePath ?? '-']);
      storageTable.push(['Credentials', sftp?.hasCredentials ? 'Configured' : 'Not configured']);
    }
    console.log(storageTable.toString());

    // Encryption settings
    console.log('\n  ENCRYPTION\n');
    const encryptionTable = new Table({
      colWidths: [25, 45],
      style: { head: [], border: [] },
    });

    encryptionTable.push(
      ['Enabled', config.encryption?.enabled ? 'Yes' : 'No'],
      ['Password File', config.encryption?.hasPassword ? 'Configured' : 'Not configured'],
    );
    console.log(encryptionTable.toString());
    console.log();
  } catch (error) {
    spinner.fail('Failed to fetch config');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function updateConfig(options: ConfigOptions): Promise<void> {
  const body: Record<string, unknown> = {};

  if (options.enabled !== undefined) body.enabled = options.enabled;
  if (options.interval) {
    try {
      body.intervalMs = parseInterval(options.interval);
    } catch (err) {
      output.error((err as Error).message);
      process.exit(1);
    }
  }
  if (options.retentionDays) body.retentionDays = parseInt(options.retentionDays, 10);
  if (options.retentionCount) body.retentionCount = parseInt(options.retentionCount, 10);

  if (Object.keys(body).length === 0) {
    output.info('No changes specified. Use --help to see available options.');
    return;
  }

  const spinner = ora('Updating backup config...').start();

  try {
    const result = await client.put<{ message: string; config: BackupConfig }>('/v1/admin/backups/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result.config);
      return;
    }

    output.success('Backup configuration updated');
    console.log(`  Enabled:         ${result.config.enabled ? 'Yes' : 'No'}`);
    console.log(`  Interval:        ${formatInterval(result.config.intervalMs)}`);
    console.log(`  Retention Days:  ${result.config.retentionDays}`);
    console.log(`  Retention Count: ${result.config.retentionCount}`);
  } catch (error) {
    spinner.fail('Failed to update config');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Storage Configuration Commands
// ============================================================================

async function configureS3Storage(options: S3StorageOptions): Promise<void> {
  const body = {
    storage: {
      type: 's3' as const,
      s3: {
        bucket: options.bucket,
        region: options.region ?? 'us-east-1',
        prefix: options.prefix ?? 'backups/',
        endpoint: options.endpoint,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    },
  };

  const spinner = ora('Configuring S3 storage...').start();

  try {
    const result = await client.put<{ message: string; config: BackupConfig; storageBackendUpdated: boolean }>('/v1/admin/backups/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result.config);
      return;
    }

    output.success('S3 storage configured successfully');
    console.log(`  Bucket:   ${options.bucket}`);
    console.log(`  Region:   ${options.region ?? 'us-east-1'}`);
    console.log(`  Prefix:   ${options.prefix ?? 'backups/'}`);
    if (options.endpoint) {
      console.log(`  Endpoint: ${options.endpoint}`);
    }
    console.log(`  Credentials: ${options.accessKeyId ? 'Provided' : 'Using IAM Role'}`);
    if (result.storageBackendUpdated) {
      console.log('\n  Storage backend updated and ready to use.');
    }
  } catch (error) {
    spinner.fail('Failed to configure S3 storage');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function configureLocalStorage(options: LocalStorageOptions): Promise<void> {
  const body = {
    storage: {
      type: 'local' as const,
      local: {
        path: options.path,
      },
    },
  };

  const spinner = ora('Configuring local storage...').start();

  try {
    const result = await client.put<{ message: string; config: BackupConfig; storageBackendUpdated: boolean }>('/v1/admin/backups/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result.config);
      return;
    }

    output.success('Local storage configured successfully');
    console.log(`  Path: ${options.path}`);
    if (result.storageBackendUpdated) {
      console.log('\n  Storage backend updated and ready to use.');
    }
  } catch (error) {
    spinner.fail('Failed to configure local storage');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function configureEncryption(options: EncryptionOptions): Promise<void> {
  if (options.enable === undefined && options.disable === undefined && !options.passwordFile) {
    output.info('No changes specified. Use --enable, --disable, or --password-file');
    return;
  }

  const body: { encryption: { enabled?: boolean; passwordFile?: string } } = {
    encryption: {},
  };

  if (options.enable) {
    body.encryption.enabled = true;
  } else if (options.disable) {
    body.encryption.enabled = false;
  }

  if (options.passwordFile) {
    body.encryption.passwordFile = options.passwordFile;
    // Enabling encryption if password file is provided
    if (options.enable === undefined && options.disable === undefined) {
      body.encryption.enabled = true;
    }
  }

  const spinner = ora('Configuring encryption...').start();

  try {
    const result = await client.put<{ message: string; config: BackupConfig }>('/v1/admin/backups/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result.config);
      return;
    }

    output.success('Encryption configuration updated');
    console.log(`  Enabled:       ${result.config.encryption?.enabled ? 'Yes' : 'No'}`);
    console.log(`  Password File: ${result.config.encryption?.hasPassword ? 'Configured' : 'Not configured'}`);
  } catch (error) {
    spinner.fail('Failed to configure encryption');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function testStorage(): Promise<void> {
  const spinner = ora('Testing storage backend...').start();

  try {
    const health = await client.get<BackupHealth>('/v1/admin/backups/health');
    spinner.stop();

    if (health.storageAccessible) {
      output.success('Storage backend is accessible and working');
    } else {
      output.error('Storage backend is not accessible');
      if (health.warnings && health.warnings.length > 0) {
        console.log('\nIssues:');
        for (const warning of health.warnings) {
          console.log(`  - ${warning}`);
        }
      }
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Failed to test storage');
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

  // Update general config
  backup
    .command('config-update')
    .description('Update general backup settings')
    .option('--enabled', 'Enable automatic backups')
    .option('--no-enabled', 'Disable automatic backups')
    .option('--interval <interval>', 'Backup interval (e.g., 1h, 30m, 1h30m)')
    .option('--retention-days <n>', 'Maximum age of backups in days')
    .option('--retention-count <n>', 'Maximum number of backups to retain')
    .option('--json', 'Output as JSON')
    .action(updateConfig);

  // ============================================================================
  // Storage Configuration Subcommands
  // ============================================================================

  const storage = backup
    .command('storage')
    .description('Configure backup storage backend');

  // Configure S3 storage
  storage
    .command('s3')
    .description('Configure S3 or S3-compatible storage (MinIO, DigitalOcean Spaces, etc.)')
    .requiredOption('--bucket <bucket>', 'S3 bucket name')
    .option('--region <region>', 'AWS region (default: us-east-1)')
    .option('--prefix <prefix>', 'Key prefix for backups (default: backups/)')
    .option('--endpoint <url>', 'Custom endpoint URL for S3-compatible storage')
    .option('--access-key-id <key>', 'AWS access key ID (omit to use IAM role)')
    .option('--secret-access-key <secret>', 'AWS secret access key')
    .option('--json', 'Output as JSON')
    .action(configureS3Storage);

  // Configure local storage
  storage
    .command('local')
    .description('Configure local filesystem storage')
    .requiredOption('--path <path>', 'Directory path for backup storage')
    .option('--json', 'Output as JSON')
    .action(configureLocalStorage);

  // Test storage connectivity
  storage
    .command('test')
    .description('Test storage backend connectivity')
    .action(testStorage);

  // ============================================================================
  // Encryption Configuration
  // ============================================================================

  backup
    .command('encryption')
    .description('Configure backup encryption')
    .option('--enable', 'Enable backup encryption')
    .option('--disable', 'Disable backup encryption')
    .option('--password-file <path>', 'Path to file containing encryption password')
    .option('--json', 'Output as JSON')
    .action(configureEncryption);
}
