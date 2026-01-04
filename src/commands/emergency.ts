import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { EmergencyDBClient, isEmergencyDbAvailable } from '../lib/db.js';
import { promptConfirm, promptNewPassword } from '../lib/prompts.js';
import * as output from '../lib/output.js';

function checkEmergencyAccess(): void {
  if (!isEmergencyDbAvailable()) {
    output.error('Emergency operations require DATABASE_URL environment variable.');
    output.info('This command should only be run directly on a vault node.');
    output.info('');
    output.info('Example:');
    output.info('  DATABASE_URL=postgres://user:pass@localhost:5432/znvault znvault emergency reset-password admin newpass');
    process.exit(1);
  }
}

export function registerEmergencyCommands(program: Command): void {
  const emergency = program
    .command('emergency')
    .description('Emergency operations (direct database access)');

  // Show warning banner
  emergency.hook('preAction', () => {
    console.log();
    console.log(chalk.bgYellow.black(' WARNING '));
    console.log(chalk.yellow('Emergency commands bypass API authentication and access the database directly.'));
    console.log(chalk.yellow('Only use these when the API is unavailable or you are locked out.'));
    console.log();
  });

  // Test database connection
  emergency
    .command('test-db')
    .description('Test database connection')
    .action(async () => {
      checkEmergencyAccess();

      const spinner = ora('Testing database connection...').start();

      try {
        const db = new EmergencyDBClient();
        const result = await db.testConnection();

        if (result.success) {
          spinner.succeed('Database connection successful');
          output.info(result.message);
        } else {
          spinner.fail('Database connection failed');
          output.error(result.message);
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Database connection failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get user status
  emergency
    .command('user-status <username>')
    .description('Get user status from database')
    .option('--json', 'Output as JSON')
    .action(async (username, options) => {
      checkEmergencyAccess();

      const spinner = ora('Fetching user status...').start();

      try {
        const db = new EmergencyDBClient();
        const result = await db.getUserStatus(username);

        spinner.stop();

        if (!result.found) {
          output.error(`User '${username}' not found`);
          process.exit(1);
        }

        if (options.json) {
          output.json(result.user);
        } else {
          output.section('User Status');
          output.keyValue({
            'ID': result.user!.id,
            'Username': result.user!.username,
            'Email': result.user!.email || '-',
            'Role': result.user!.role,
            'Status': output.formatStatus(result.user!.status),
            'TOTP Enabled': result.user!.totpEnabled,
            'Failed Attempts': result.user!.failedAttempts,
            'Locked Until': result.user!.lockedUntil || '-',
            'Last Login': result.user!.lastLogin || 'Never',
          });
        }
      } catch (err) {
        spinner.fail('Failed to get user status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Reset password
  emergency
    .command('reset-password <username> [newPassword]')
    .description('Reset user password directly in database')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (username, newPassword, options) => {
      checkEmergencyAccess();

      try {
        if (!options.yes) {
          output.warn('This will:');
          output.info('  - Reset the user\'s password');
          output.info('  - Disable TOTP/2FA');
          output.info('  - Unlock the account');
          output.info('  - Require password change on next login');
          console.log();

          const confirmed = await promptConfirm(
            `Are you sure you want to reset password for '${username}'?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const password = newPassword || await promptNewPassword();
        const spinner = ora('Resetting password...').start();

        try {
          const db = new EmergencyDBClient();
          const result = await db.resetPassword(username, password);

          if (result.success) {
            spinner.succeed('Password reset successful');
            output.info(result.message);
            console.log();
            output.warn('User will be required to change password on next login.');
          } else {
            spinner.fail('Password reset failed');
            output.error(result.message);
            process.exit(1);
          }
        } catch (err) {
          spinner.fail('Password reset failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Unlock user
  emergency
    .command('unlock <username>')
    .description('Unlock a locked user account directly in database')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (username, options) => {
      checkEmergencyAccess();

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to unlock user '${username}'?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Unlocking user...').start();

        try {
          const db = new EmergencyDBClient();
          const result = await db.unlockUser(username);

          if (result.success) {
            spinner.succeed('User unlocked');
            output.info(result.message);
          } else {
            spinner.fail('Unlock failed');
            output.error(result.message);
            process.exit(1);
          }
        } catch (err) {
          spinner.fail('Unlock failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Disable TOTP
  emergency
    .command('disable-totp <username>')
    .description('Disable TOTP/2FA for a user directly in database')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (username, options) => {
      checkEmergencyAccess();

      try {
        if (!options.yes) {
          output.warn('This will disable 2FA authentication for the user.');
          console.log();

          const confirmed = await promptConfirm(
            `Are you sure you want to disable TOTP for '${username}'?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Disabling TOTP...').start();

        try {
          const db = new EmergencyDBClient();
          const result = await db.disableTotp(username);

          if (result.success) {
            spinner.succeed('TOTP disabled');
            output.info(result.message);
          } else {
            spinner.fail('Failed to disable TOTP');
            output.error(result.message);
            process.exit(1);
          }
        } catch (err) {
          spinner.fail('Failed to disable TOTP');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
