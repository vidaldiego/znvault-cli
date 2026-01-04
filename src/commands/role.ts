// Path: znvault-cli/src/commands/role.ts
// CLI commands for RBAC role management

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface Role {
  id: string;
  name: string;
  description?: string;
  is_system: boolean;
  permissions: string[];
  tenant_id?: string;
  user_count?: number;
  created_at: string;
  updated_at: string;
}

interface RoleListResponse {
  data: Role[];
  page: number;
  pageSize: number;
  total: number;
}

interface UserRolesResponse {
  roles: Role[];
  permissions: string[];
}

interface ListOptions {
  tenant?: string;
  includeSystem?: boolean;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface CreateOptions {
  tenant?: string;
  description?: string;
  permissions: string;
  json?: boolean;
}

interface UpdateOptions {
  name?: string;
  description?: string;
  permissions?: string;
  json?: boolean;
}

interface DeleteOptions {
  force?: boolean;
}

interface AssignOptions {
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatPermissions(permissions: string[]): string {
  if (permissions.length === 0) return 'None';
  if (permissions.length <= 3) return permissions.join(', ');
  return `${permissions.slice(0, 2).join(', ')} +${permissions.length - 2} more`;
}

function truncate(str: string, maxLen = 30): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// Command Implementations
// ============================================================================

async function listRoles(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching roles...').start();

  try {
    const query: Record<string, string | undefined> = {};
    if (options.tenant) query.tenantId = options.tenant;
    if (options.includeSystem !== undefined) query.includeSystem = String(options.includeSystem);

    const response = await client.get<RoleListResponse>('/v1/roles?' + new URLSearchParams(query as Record<string, string>).toString());
    spinner.stop();

    if (options.json) {
      output.json(response.data);
      return;
    }

    if (response.data.length === 0) {
      output.info('No roles found');
      return;
    }

    const table = new Table({
      head: ['ID', 'Name', 'System', 'Users', 'Permissions', 'Description'],
      colWidths: [38, 20, 8, 7, 30, 30],
      wordWrap: true,
    });

    for (const role of response.data) {
      table.push([
        role.id,
        role.name,
        role.is_system ? 'Yes' : 'No',
        String(role.user_count ?? 0),
        formatPermissions(role.permissions),
        truncate(role.description || '-'),
      ]);
    }

    console.log(table.toString());
    output.info(`Total: ${response.total} role(s)`);
  } catch (error) {
    spinner.fail('Failed to list roles');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getRole(roleId: string, options: GetOptions): Promise<void> {
  const spinner = ora('Fetching role...').start();

  try {
    const role = await client.get<Role>(`/v1/roles/${roleId}`);
    spinner.stop();

    if (options.json) {
      output.json(role);
      return;
    }

    const table = new Table({
      colWidths: [20, 60],
    });

    table.push(
      ['ID', role.id],
      ['Name', role.name],
      ['Description', role.description || '-'],
      ['System Role', role.is_system ? 'Yes' : 'No'],
      ['Tenant', role.tenant_id || 'System'],
      ['Created', formatDate(role.created_at)],
      ['Updated', formatDate(role.updated_at)],
    );

    console.log(table.toString());

    if (role.permissions.length > 0) {
      console.log('\nPermissions:');
      for (const perm of role.permissions) {
        console.log(`  - ${perm}`);
      }
    }
  } catch (error) {
    spinner.fail('Failed to get role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function createRole(name: string, options: CreateOptions): Promise<void> {
  if (!options.permissions) {
    output.error('Permissions are required. Use --permissions <perm1,perm2,...>');
    process.exit(1);
  }

  const spinner = ora('Creating role...').start();

  try {
    const body: Record<string, unknown> = {
      name,
      permissions: options.permissions.split(',').map(p => p.trim()),
    };

    if (options.tenant) body.tenantId = options.tenant;
    if (options.description) body.description = options.description;

    const result = await client.post<Role>('/v1/roles', body);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Role created successfully!');
    console.log(`  ID:   ${result.id}`);
    console.log(`  Name: ${result.name}`);
    console.log(`  Permissions: ${result.permissions.length}`);
  } catch (error) {
    spinner.fail('Failed to create role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function updateRole(roleId: string, options: UpdateOptions): Promise<void> {
  // Get current role first
  const spinner = ora('Fetching role...').start();

  try {
    const current = await client.get<Role>(`/v1/roles/${roleId}`);
    spinner.stop();

    if (current.is_system) {
      output.error('Cannot update system roles');
      process.exit(1);
    }

    const body: Record<string, unknown> = {};

    if (options.name) body.name = options.name;
    if (options.description) body.description = options.description;
    if (options.permissions) {
      body.permissions = options.permissions.split(',').map(p => p.trim());
    }

    if (Object.keys(body).length === 0) {
      output.info('No changes specified');
      return;
    }

    const updateSpinner = ora('Updating role...').start();
    const result = await client.patch<Role>(`/v1/roles/${roleId}`, body);
    updateSpinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Role updated successfully!');
  } catch (error) {
    spinner.fail('Failed to update role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function deleteRole(roleId: string, options: DeleteOptions): Promise<void> {
  if (!options.force) {
    const spinner = ora('Fetching role...').start();
    try {
      const role = await client.get<Role>(`/v1/roles/${roleId}`);
      spinner.stop();

      if (role.is_system) {
        output.error('Cannot delete system roles');
        process.exit(1);
      }

      const userCount = role.user_count ?? 0;
      const message = userCount > 0
        ? `Delete role "${role.name}"? It is assigned to ${userCount} user(s).`
        : `Delete role "${role.name}"?`;

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message,
          default: false,
        },
      ]);

      if (!confirm) {
        output.info('Deletion cancelled');
        return;
      }
    } catch (error) {
      spinner.fail('Failed to fetch role');
      output.error((error as Error).message);
      process.exit(1);
    }
  }

  const deleteSpinner = ora('Deleting role...').start();

  try {
    await client.delete(`/v1/roles/${roleId}`);
    deleteSpinner.stop();
    output.success('Role deleted successfully');
  } catch (error) {
    deleteSpinner.fail('Failed to delete role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function assignRole(roleId: string, userId: string, options: AssignOptions): Promise<void> {
  const spinner = ora('Assigning role...').start();

  try {
    await client.post(`/v1/users/${userId}/roles`, { roleId });
    spinner.stop();

    if (options.json) {
      output.json({ success: true, roleId, userId });
      return;
    }

    output.success(`Role ${roleId} assigned to user ${userId}`);
  } catch (error) {
    spinner.fail('Failed to assign role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function removeRole(roleId: string, userId: string): Promise<void> {
  const spinner = ora('Removing role...').start();

  try {
    await client.delete(`/v1/users/${userId}/roles/${roleId}`);
    spinner.stop();
    output.success(`Role ${roleId} removed from user ${userId}`);
  } catch (error) {
    spinner.fail('Failed to remove role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getUserRoles(userId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching user roles...').start();

  try {
    const response = await client.get<UserRolesResponse>(`/v1/users/${userId}/roles`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.roles.length === 0) {
      output.info('User has no roles assigned');
      return;
    }

    console.log('Roles:');
    const table = new Table({
      head: ['ID', 'Name', 'System', 'Description'],
      colWidths: [38, 20, 8, 40],
    });

    for (const role of response.roles) {
      table.push([
        role.id,
        role.name,
        role.is_system ? 'Yes' : 'No',
        truncate(role.description || '-', 38),
      ]);
    }

    console.log(table.toString());

    if (response.permissions.length > 0) {
      console.log(`\nEffective Permissions (${response.permissions.length}):`);
      // Group permissions by category
      const grouped: Record<string, string[]> = {};
      for (const perm of response.permissions) {
        const category = perm.split(':')[0] || 'other';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(perm);
      }
      for (const [category, perms] of Object.entries(grouped)) {
        console.log(`  ${category}:`);
        for (const p of perms) {
          console.log(`    - ${p}`);
        }
      }
    }
  } catch (error) {
    spinner.fail('Failed to fetch user roles');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getUserPermissions(userId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching user permissions...').start();

  try {
    const response = await client.get<{ permissions: string[] }>(`/v1/users/${userId}/permissions`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.permissions.length === 0) {
      output.info('User has no permissions');
      return;
    }

    console.log(`Permissions (${response.permissions.length}):`);

    // Group by category
    const grouped: Record<string, string[]> = {};
    for (const perm of response.permissions) {
      const category = perm.split(':')[0] || 'other';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(perm);
    }

    for (const [category, perms] of Object.entries(grouped).sort()) {
      console.log(`\n  ${category}:`);
      for (const p of perms.sort()) {
        console.log(`    - ${p}`);
      }
    }
  } catch (error) {
    spinner.fail('Failed to fetch user permissions');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerRoleCommands(program: Command): void {
  const role = program
    .command('role')
    .description('RBAC role management');

  // List roles
  role
    .command('list')
    .description('List all roles')
    .option('-t, --tenant <id>', 'Filter by tenant')
    .option('--include-system', 'Include system roles (default: true)')
    .option('--no-include-system', 'Exclude system roles')
    .option('--json', 'Output as JSON')
    .action(listRoles);

  // Get role
  role
    .command('get <roleId>')
    .description('Get role details')
    .option('--json', 'Output as JSON')
    .action(getRole);

  // Create role
  role
    .command('create <name>')
    .description('Create a custom role')
    .option('-t, --tenant <id>', 'Tenant ID (optional, creates system role if not specified)')
    .option('-d, --description <desc>', 'Role description')
    .requiredOption('-p, --permissions <perms>', 'Comma-separated permissions')
    .option('--json', 'Output as JSON')
    .action(createRole);

  // Update role
  role
    .command('update <roleId>')
    .description('Update a custom role')
    .option('-n, --name <name>', 'New role name')
    .option('-d, --description <desc>', 'New description')
    .option('-p, --permissions <perms>', 'New permissions (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(updateRole);

  // Delete role
  role
    .command('delete <roleId>')
    .description('Delete a custom role')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteRole);

  // Assign role to user
  role
    .command('assign <roleId> <userId>')
    .description('Assign a role to a user')
    .option('--json', 'Output as JSON')
    .action(assignRole);

  // Remove role from user
  role
    .command('remove <roleId> <userId>')
    .description('Remove a role from a user')
    .action(removeRole);

  // Get user's roles
  role
    .command('user-roles <userId>')
    .description('Get all roles assigned to a user')
    .option('--json', 'Output as JSON')
    .action(getUserRoles);

  // Get user's permissions
  role
    .command('user-permissions <userId>')
    .description('Get all effective permissions for a user')
    .option('--json', 'Output as JSON')
    .action(getUserPermissions);
}
