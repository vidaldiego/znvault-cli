// Path: znvault-cli/src/commands/backup/operations.ts
// Backup CRUD operations

import { readFile, writeFile } from 'node:fs/promises';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {
  formatDate,
  formatBytes,
  formatDuration,
  formatStatus,
  formatAge,
} from './helpers.js';
import type {
  Backup,
  BackupListResponse,
  BackupStats,
  BackupHealth,
  ListOptions,
  GetOptions,
  DeleteOptions,
  RestoreOptions,
  CreateBackupOptions,
  GenerateKeyOptions,
  GenerateKeyResponse,
  RestoreResult,
} from './types.js';

export async function listBackups(options: ListOptions): Promise<void> {
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

export async function getBackup(id: string, options: GetOptions): Promise<void> {
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

export async function createBackup(options: CreateBackupOptions): Promise<void> {
  // Get user key if provided
  let userKey: string | undefined;
  if (options.userKey) {
    userKey = options.userKey;
  } else if (options.userKeyFile) {
    try {
      const keyContent = await readFile(options.userKeyFile, 'utf-8');
      userKey = keyContent.trim();
    } catch (error) {
      output.error(`Failed to read user key file: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  const encryptionMode = userKey ? 'user-key encrypted' : 'default';
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Create a new ${encryptionMode} backup now?`,
      default: true,
    },
  ]);

  if (!confirm) {
    output.info('Backup cancelled');
    return;
  }

  const spinner = ora('Creating backup...').start();

  try {
    const body = userKey ? { userKey } : {};
    const result = await client.post<{ message: string; backup: Backup; encryptionMode?: string }>('/v1/admin/backups', body);
    spinner.stop();

    output.success('Backup created successfully!');
    console.log(`  ID:         ${result.backup.id}`);
    console.log(`  Filename:   ${result.backup.filename}`);
    console.log(`  Size:       ${formatBytes(result.backup.backupSizeBytes)}`);
    console.log(`  Encrypted:  ${result.backup.encrypted ? 'Yes' : 'No'}`);
    if (result.encryptionMode) {
      console.log(`  Encryption: ${result.encryptionMode}`);
    }
    console.log(`  Duration:   ${formatDuration(result.backup.metadata?.duration)}`);
  } catch (error) {
    spinner.fail('Failed to create backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

export async function generateKey(options: GenerateKeyOptions): Promise<void> {
  const spinner = ora('Generating master key...').start();

  try {
    const result = await client.post<GenerateKeyResponse>('/v1/admin/backups/generate-key', {});
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    // Save to file if requested
    if (options.output) {
      await writeFile(options.output, result.base64, 'utf-8');
      output.success(`Master key saved to: ${options.output}`);
    }

    output.success('Master key generated successfully!');
    console.log('');
    console.log('  Key ID:  ', result.keyId);
    console.log('  Base64:  ', result.base64);
    console.log('  Hex:     ', result.hex);
    console.log('');
    console.log('  IMPORTANT: Store this key securely in a password manager!');
    console.log('  You will need it to restore backups encrypted with user-key mode.');
    console.log('  If you lose this key, encrypted backups cannot be recovered.');
    console.log('');
  } catch (error) {
    spinner.fail('Failed to generate key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

export async function verifyBackup(id: string): Promise<void> {
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

export async function deleteBackup(id: string, options: DeleteOptions): Promise<void> {
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

export async function restoreBackup(id: string, options: RestoreOptions): Promise<void> {
  // Fetch backup details first
  const fetchSpinner = ora('Fetching backup details...').start();
  let backup: Backup;

  try {
    backup = await client.get<Backup>(`/v1/admin/backups/${id}`);
    fetchSpinner.stop();
  } catch (error) {
    fetchSpinner.fail('Failed to fetch backup');
    output.error((error as Error).message);
    process.exit(1);
  }

  // Get user key if provided
  let userKey: string | undefined;
  if (options.userKey) {
    userKey = options.userKey;
  } else if (options.userKeyFile) {
    try {
      const keyContent = await readFile(options.userKeyFile, 'utf-8');
      userKey = keyContent.trim();
    } catch (error) {
      output.error(`Failed to read user key file: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Get password if provided
  let password: string | undefined;
  if (options.password) {
    password = options.password;
  } else if (options.passwordFile) {
    try {
      const passContent = await readFile(options.passwordFile, 'utf-8');
      password = passContent.trim();
    } catch (error) {
      output.error(`Failed to read password file: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Show warnings and get confirmation
  if (!options.force) {
    console.log('\n');
    output.warn('WARNING: This is a DESTRUCTIVE operation!');
    console.log('');
    console.log('  Backup to restore:');
    console.log(`    ID:        ${backup.id}`);
    console.log(`    Filename:  ${backup.filename}`);
    console.log(`    Size:      ${formatBytes(backup.backupSizeBytes)}`);
    console.log(`    Created:   ${formatDate(backup.createdAt)}`);
    console.log(`    Encrypted: ${backup.encrypted ? 'Yes' : 'No'}`);
    console.log('');

    if (options.restoreLmk) {
      output.warn('LMK RESTORE ENABLED: This will change the master encryption key!');
      output.warn('A server restart will be REQUIRED after restore.');
      console.log('');
    }

    if (!options.noPreBackup) {
      console.log('  A pre-restore backup will be created before restoring.');
      console.log('');
    }

    const confirmPhrase = `RESTORE-${backup.id.slice(0, 8)}`;
    console.log(`  To proceed, type: ${confirmPhrase}`);
    console.log('');

    const { confirmation } = await inquirer.prompt<{ confirmation: string }>([
      {
        type: 'input',
        name: 'confirmation',
        message: 'Confirmation phrase:',
      },
    ]);

    if (confirmation !== confirmPhrase) {
      output.error('Confirmation phrase does not match. Restore cancelled.');
      process.exit(1);
    }
  }

  const restoreSpinner = ora('Restoring backup...').start();

  try {
    const confirmPhrase = `RESTORE-${backup.id.slice(0, 8)}`;
    const body: {
      confirmPhrase: string;
      createPreRestoreBackup?: boolean;
      userKey?: string;
      password?: string;
      options?: { restoreLmk?: boolean };
    } = {
      confirmPhrase,
      createPreRestoreBackup: !options.noPreBackup,
    };

    if (userKey) {
      body.userKey = userKey;
    }
    if (password) {
      body.password = password;
    }
    if (options.restoreLmk) {
      body.options = { restoreLmk: true };
    }

    const result = await client.post<RestoreResult>(`/v1/admin/backups/${id}/restore`, body);
    restoreSpinner.stop();

    output.success('Backup restored successfully!');
    console.log('');
    console.log(`  Tables restored:  ${result.tablesRestored}`);
    console.log(`  LMK restored:     ${result.lmkRestored ? 'Yes' : 'No'}`);
    console.log(`  Duration:         ${formatDuration(result.duration)}`);

    if (result.preRestoreBackupId) {
      console.log(`  Pre-restore backup: ${result.preRestoreBackupId}`);
    }

    if (result.warnings.length > 0) {
      console.log('');
      output.warn('Warnings:');
      for (const warning of result.warnings) {
        console.log(`    - ${warning}`);
      }
    }

    if (result.lmkRestored) {
      console.log('');
      output.warn('IMPORTANT: Server restart is REQUIRED due to LMK change!');
    }
  } catch (error) {
    restoreSpinner.fail('Failed to restore backup');
    output.error((error as Error).message);
    process.exit(1);
  }
}

export async function showStats(options: { json?: boolean }): Promise<void> {
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

export async function showHealth(options: { json?: boolean }): Promise<void> {
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
