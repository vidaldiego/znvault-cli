// Path: src/commands/sso/users.ts

/**
 * SSO App user access management
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import type {
  ListUsersResponse,
  UserListOptions,
  UserGrantOptions,
  UserRevokeOptions,
  UserSetRoleOptions,
} from './types.js';
import { buildTenantQuery } from './helpers.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function listUsers(appId: string, options: UserListOptions): Promise<void> {
  const spinner = output.spinner('Fetching users...').start();

  try {
    const query = buildTenantQuery(options.tenant);
    const response = await client.get<ListUsersResponse>(
      `/v1/sso/apps/${encodeURIComponent(appId)}/users${query}`
    );
    spinner.stop();

    if (options.json) {
      output.json(response.users);
      return;
    }

    if (response.users.length === 0) {
      output.info('No users have access to this app');
      return;
    }

    output.table(
      ['Username', 'Email', 'Role', 'Granted At', 'Last Used'],
      response.users.map(u => [
        u.username,
        u.email ?? '-',
        u.role,
        output.formatDate(u.granted_at),
        u.last_used_at ? output.formatDate(u.last_used_at) : 'Never',
      ])
    );

    output.info(`Total: ${response.users.length} user(s)`);
  } catch (err) {
    spinner.fail('Failed to list users');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function grantAccess(appId: string, userId: string, options: UserGrantOptions): Promise<void> {
  const spinner = output.spinner('Granting access...').start();

  try {
    const query = buildTenantQuery(options.tenant);
    await client.post(`/v1/sso/apps/${encodeURIComponent(appId)}/users${query}`, {
      user_id: userId,
      role: options.role,
    });
    spinner.succeed(`Access granted to user ${userId} with role "${options.role}"`);
  } catch (err) {
    spinner.fail('Failed to grant access');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function revokeAccess(appId: string, userId: string, options: UserRevokeOptions): Promise<void> {
  try {
    const query = buildTenantQuery(options.tenant);

    if (!options.yes) {
      const confirmed = await promptConfirm(`Revoke access for user ${userId}?`);
      if (!confirmed) {
        output.info('Revoke cancelled');
        return;
      }
    }

    const spinner = output.spinner('Revoking access...').start();

    try {
      await client.delete(`/v1/sso/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}${query}`);
      spinner.succeed(`Access revoked for user ${userId}`);
    } catch (err) {
      spinner.fail('Failed to revoke access');
      throw err;
    }
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function setRole(appId: string, userId: string, role: string, options: UserSetRoleOptions): Promise<void> {
  const spinner = output.spinner('Updating role...').start();

  try {
    const query = buildTenantQuery(options.tenant);
    await client.patch(
      `/v1/sso/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}${query}`,
      { role }
    );
    spinner.succeed(`Role updated to "${role}" for user ${userId}`);
  } catch (err) {
    spinner.fail('Failed to update role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerUserCommands(parent: Command): void {
  const users = parent
    .command('users')
    .description('Manage user access to SSO apps');

  // List users with access
  users
    .command('list <appId>')
    .description('List users with access to an SSO app')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(listUsers);

  // Grant user access
  users
    .command('grant <appId> <userId>')
    .description('Grant a user access to an SSO app')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--role <role>', 'Role to assign', 'user')
    .action(grantAccess);

  // Revoke user access
  users
    .command('revoke <appId> <userId>')
    .description('Revoke a user\'s access to an SSO app')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(revokeAccess);

  // Update user role
  users
    .command('set-role <appId> <userId> <role>')
    .description('Update a user\'s role in an SSO app')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .action(setRole);
}
