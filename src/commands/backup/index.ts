// Path: znvault-cli/src/commands/backup/index.ts
// Command registration for backup CLI

import { type Command } from 'commander';
import {
  listBackups,
  getBackup,
  createBackup,
  generateKey,
  verifyBackup,
  deleteBackup,
  restoreBackup,
  showStats,
  showHealth,
} from './operations.js';
import {
  showConfig,
  updateConfig,
  configureS3Storage,
  configureLocalStorage,
  configureEncryption,
  testStorage,
} from './config.js';

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
    .option('--user-key <key>', 'Base64-encoded user master key for encryption')
    .option('--user-key-file <path>', 'Path to file containing the user master key')
    .action(createBackup);

  // Generate master key
  backup
    .command('generate-key')
    .description('Generate a new master key for user-key backup encryption')
    .option('--output <path>', 'Save key to file')
    .option('--json', 'Output as JSON')
    .action(generateKey);

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

  // Restore backup
  backup
    .command('restore <id>')
    .description('Restore from a backup (DESTRUCTIVE - will overwrite current database)')
    .option('--user-key <key>', 'Base64-encoded user master key (for user-key encrypted backups)')
    .option('--user-key-file <path>', 'Path to file containing the user master key')
    .option('--password <password>', 'Encryption password (for password-encrypted backups)')
    .option('--password-file <path>', 'Path to file containing the encryption password')
    .option('--restore-lmk', 'Also restore the LMK (DANGEROUS - changes master encryption key)')
    .option('--no-pre-backup', 'Skip creating a pre-restore backup (not recommended)')
    .option('-f, --force', 'Skip confirmation prompts')
    .action(restoreBackup);

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

  // Storage Configuration Subcommands
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

  // Encryption Configuration
  backup
    .command('encryption')
    .description('Configure backup encryption')
    .option('--enable', 'Enable backup encryption')
    .option('--disable', 'Disable backup encryption')
    .option('--password-file <path>', 'Path to file containing encryption password')
    .option('--json', 'Output as JSON')
    .action(configureEncryption);
}

// Re-export types for external use
export * from './types.js';
