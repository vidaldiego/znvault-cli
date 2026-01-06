// Path: znvault-cli/src/commands/backup/config.ts
// Backup configuration management

import ora from 'ora';
import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { formatInterval, parseInterval } from './helpers.js';
import type {
  BackupConfig,
  BackupHealth,
  ConfigOptions,
  S3StorageOptions,
  LocalStorageOptions,
  EncryptionOptions,
} from './types.js';

export async function showConfig(options: { json?: boolean }): Promise<void> {
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

export async function updateConfig(options: ConfigOptions): Promise<void> {
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

export async function configureS3Storage(options: S3StorageOptions): Promise<void> {
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

export async function configureLocalStorage(options: LocalStorageOptions): Promise<void> {
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

export async function configureEncryption(options: EncryptionOptions): Promise<void> {
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

export async function testStorage(): Promise<void> {
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
