import { Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import { promptConfirm, promptNewPassword } from '../lib/prompts.js';
import * as output from '../lib/output.js';

export function registerSuperadminCommands(program: Command): void {
  const superadmin = program
    .command('superadmin')
    .description('Superadmin management commands');

  // List superadmins
  superadmin
    .command('list')
    .description('List all superadmins')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Fetching superadmins...').start();

      try {
        const admins = await mode.listSuperadmins();
        spinner.stop();

        if (options.json) {
          output.json(admins);
          return;
        }

        if (admins.length === 0) {
          output.info('No superadmins found');
          return;
        }

        output.table(
          ['ID', 'Username', 'Email', 'Status', '2FA', 'Failed', 'Last Login'],
          admins.map(a => [
            a.id.substring(0, 8),
            a.username,
            a.email || '-',
            a.status,
            a.totpEnabled,
            a.failedAttempts,
            a.lastLogin ? output.formatRelativeTime(a.lastLogin) : 'Never',
          ])
        );

        output.info(`Total: ${admins.length} superadmin(s)`);
      } catch (err) {
        spinner.fail('Failed to list superadmins');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Create superadmin (API only)
  superadmin
    .command('create <username> <password>')
    .description('Create a new superadmin')
    .option('--email <email>', 'Superadmin email')
    .option('--json', 'Output as JSON')
    .action(async (username, password, options) => {
      if (mode.getMode() === 'local') {
        output.error('Superadmin creation requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = ora('Creating superadmin...').start();

      try {
        const result = await client.createSuperadmin({
          username,
          password,
          email: options.email,
        });
        spinner.succeed('Superadmin created successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Username': result.username,
            'Email': result.email || '-',
            'Status': result.status,
            'Created': output.formatDate(result.createdAt),
          });
        }
      } catch (err) {
        spinner.fail('Failed to create superadmin');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Reset superadmin password (API only - requires authentication)
  superadmin
    .command('reset-password <username> [newPassword]')
    .description('Reset superadmin password')
    .action(async (username, newPassword) => {
      if (mode.getMode() === 'local') {
        output.error('Superadmin password reset requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        const password = newPassword || await promptNewPassword();
        const spinner = ora('Resetting password...').start();

        try {
          const result = await client.resetSuperadminPassword(username, password);
          spinner.succeed('Password reset successfully');
          if (result.message) {
            output.info(result.message);
          }
        } catch (err) {
          spinner.fail('Failed to reset password');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Unlock superadmin (API only)
  superadmin
    .command('unlock <username>')
    .description('Unlock a locked superadmin account')
    .action(async (username) => {
      if (mode.getMode() === 'local') {
        output.error('Superadmin unlock requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = ora('Unlocking superadmin...').start();

      try {
        const result = await client.unlockSuperadmin(username);
        spinner.succeed('Superadmin unlocked successfully');
        if (result.message) {
          output.info(result.message);
        }
      } catch (err) {
        spinner.fail('Failed to unlock superadmin');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Disable superadmin (API only)
  superadmin
    .command('disable <username>')
    .description('Disable a superadmin account')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (username, options) => {
      if (mode.getMode() === 'local') {
        output.error('Superadmin disable requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to disable superadmin '${username}'?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Disabling superadmin...').start();

        try {
          const result = await client.disableSuperadmin(username);
          spinner.succeed('Superadmin disabled successfully');
          if (result.message) {
            output.info(result.message);
          }
        } catch (err) {
          spinner.fail('Failed to disable superadmin');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Enable superadmin (API only)
  superadmin
    .command('enable <username>')
    .description('Enable a disabled superadmin account')
    .action(async (username) => {
      if (mode.getMode() === 'local') {
        output.error('Superadmin enable requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = ora('Enabling superadmin...').start();

      try {
        const result = await client.enableSuperadmin(username);
        spinner.succeed('Superadmin enabled successfully');
        if (result.message) {
          output.info(result.message);
        }
      } catch (err) {
        spinner.fail('Failed to enable superadmin');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
