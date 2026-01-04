import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import { promptConfirm, promptNewPassword } from '../lib/prompts.js';
import * as output from '../lib/output.js';

// Option interfaces for each command
interface ListUserOptions {
  tenant?: string;
  role?: string;
  status?: string;
  json?: boolean;
}

interface CreateUserOptions {
  email?: string;
  tenant?: string;
  role?: 'user' | 'admin';
  json?: boolean;
}

interface GetUserOptions {
  json?: boolean;
}

interface UpdateUserOptions {
  email?: string;
  password?: string;
  role?: string;
  status?: string;
  json?: boolean;
}

interface DeleteUserOptions {
  yes?: boolean;
}

interface TotpDisableOptions {
  yes?: boolean;
}

export function registerUserCommands(program: Command): void {
  const user = program
    .command('user')
    .description('User management commands');

  // List users
  user
    .command('list')
    .description('List users')
    .option('--tenant <id>', 'Filter by tenant ID')
    .option('--role <role>', 'Filter by role (user|admin|superadmin)')
    .option('--status <status>', 'Filter by status (active|disabled|locked)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListUserOptions) => {
      const spinner = ora('Fetching users...').start();

      try {
        const users = await mode.listUsers({
          tenantId: options.tenant,
          role: options.role,
          status: options.status,
        });
        spinner.stop();

        if (options.json) {
          output.json(users);
          return;
        }

        if (users.length === 0) {
          output.info('No users found');
          return;
        }

        output.table(
          ['ID', 'Username', 'Email', 'Role', 'Tenant', 'Status', '2FA', 'Last Login'],
          users.map(u => [
            u.id.substring(0, 8),
            u.username,
            u.email ?? '-',
            u.role,
            u.tenantId ?? '-',
            u.status,
            u.totpEnabled,
            u.lastLogin ? output.formatRelativeTime(u.lastLogin) : 'Never',
          ])
        );

        output.info(`Total: ${users.length} user(s)`);
      } catch (err) {
        spinner.fail('Failed to list users');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Create user (API only)
  user
    .command('create <username> <password>')
    .description('Create a new user')
    .option('--email <email>', 'User email')
    .option('--tenant <id>', 'Tenant ID')
    .option('--role <role>', 'User role (user|admin)', 'user')
    .option('--json', 'Output as JSON')
    .action(async (username: string, password: string, options: CreateUserOptions) => {
      if (mode.getMode() === 'local') {
        output.error('User creation requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = ora('Creating user...').start();

      try {
        const result = await client.createUser({
          username,
          password,
          email: options.email,
          tenantId: options.tenant,
          role: options.role,
        });
        spinner.succeed('User created successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Username': result.username,
            'Email': result.email ?? '-',
            'Role': result.role,
            'Tenant': result.tenantId ?? '-',
            'Status': result.status,
            'Created': output.formatDate(result.createdAt),
          });
        }
      } catch (err) {
        spinner.fail('Failed to create user');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get user
  user
    .command('get <id>')
    .description('Get user details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetUserOptions) => {
      const spinner = ora('Fetching user...').start();

      try {
        const result = await mode.getUser(id);
        spinner.stop();

        if (!result) {
          output.error(`User '${id}' not found`);
          process.exit(1);
        }

        if (options.json) {
          output.json(result);
          return;
        }

        output.section('User Details');
        output.keyValue({
          'ID': result.id,
          'Username': result.username,
          'Email': result.email ?? '-',
          'Role': result.role,
          'Tenant': result.tenantId ?? '-',
          'Status': result.status,
          '2FA Enabled': result.totpEnabled,
          'Failed Attempts': result.failedAttempts,
          'Locked Until': result.lockedUntil ? output.formatDate(result.lockedUntil) : '-',
          'Last Login': result.lastLogin ? output.formatDate(result.lastLogin) : 'Never',
          'Created': output.formatDate(result.createdAt),
          'Updated': output.formatDate(result.updatedAt),
        });
        console.log();
      } catch (err) {
        spinner.fail('Failed to get user');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Update user (API only)
  user
    .command('update <id>')
    .description('Update user settings')
    .option('--email <email>', 'New email')
    .option('--password <password>', 'New password')
    .option('--role <role>', 'New role (user|admin)')
    .option('--status <status>', 'New status (active|disabled)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdateUserOptions) => {
      if (mode.getMode() === 'local') {
        output.error('User update requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};
      if (options.email) updates.email = options.email;
      if (options.password) updates.password = options.password;
      if (options.role) updates.role = options.role;
      if (options.status) updates.status = options.status;

      if (Object.keys(updates).length === 0) {
        output.error('No updates specified. Use --email, --password, --role, or --status');
        process.exit(1);
      }

      const spinner = ora('Updating user...').start();

      try {
        const result = await client.updateUser(id, updates as Parameters<typeof client.updateUser>[1]);
        spinner.succeed('User updated successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Username': result.username,
            'Status': result.status,
            'Updated': output.formatDate(result.updatedAt),
          });
        }
      } catch (err) {
        spinner.fail('Failed to update user');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete user (API only)
  user
    .command('delete <id>')
    .description('Delete a user')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: DeleteUserOptions) => {
      if (mode.getMode() === 'local') {
        output.error('User deletion requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to delete user '${id}'? This cannot be undone.`
          );
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting user...').start();

        try {
          await client.deleteUser(id);
          spinner.succeed(`User '${id}' deleted successfully`);
        } catch (err) {
          spinner.fail('Failed to delete user');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Unlock user - works in both modes
  user
    .command('unlock <id>')
    .description('Unlock a locked user account')
    .action(async (id: string) => {
      const spinner = ora('Unlocking user...').start();

      try {
        if (mode.getMode() === 'local') {
          // Local mode - use direct DB
          const result = await mode.unlockUser(id);
          if (result.success) {
            spinner.succeed('User unlocked successfully');
            output.info(result.message);
          } else {
            spinner.fail('Failed to unlock user');
            output.error(result.message);
            process.exit(1);
          }
        } else {
          // API mode
          const result = await client.unlockUser(id);
          spinner.succeed('User unlocked successfully');
          if (result.message) {
            output.info(result.message);
          }
        }
      } catch (err) {
        spinner.fail('Failed to unlock user');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Reset password - works in both modes
  user
    .command('reset-password <id> [newPassword]')
    .description('Reset user password')
    .action(async (id: string, newPassword?: string) => {
      try {
        const password = newPassword ?? await promptNewPassword();
        const spinner = ora('Resetting password...').start();

        try {
          if (mode.getMode() === 'local') {
            // Local mode - use direct DB
            const result = await mode.resetPassword(id, password);
            if (result.success) {
              spinner.succeed('Password reset successfully');
              output.info(result.message);
            } else {
              spinner.fail('Failed to reset password');
              output.error(result.message);
              process.exit(1);
            }
          } else {
            // API mode
            const result = await client.resetUserPassword(id, password);
            spinner.succeed('Password reset successfully');
            if (result.message) {
              output.info(result.message);
            }
          }
        } catch (err) {
          spinner.fail('Failed to reset password');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Disable TOTP - works in both modes
  user
    .command('totp-disable <id>')
    .description('Disable 2FA/TOTP for a user')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: TotpDisableOptions) => {
      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to disable 2FA for user '${id}'?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Disabling TOTP...').start();

        try {
          if (mode.getMode() === 'local') {
            // Local mode - use direct DB
            const result = await mode.disableTotp(id);
            if (result.success) {
              spinner.succeed('TOTP disabled successfully');
              output.info(result.message);
            } else {
              spinner.fail('Failed to disable TOTP');
              output.error(result.message);
              process.exit(1);
            }
          } else {
            // API mode
            const result = await client.disableUserTotp(id);
            spinner.succeed('TOTP disabled successfully');
            if (result.message) {
              output.info(result.message);
            }
          }
        } catch (err) {
          spinner.fail('Failed to disable TOTP');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
