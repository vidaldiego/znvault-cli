// Path: znvault-cli/src/commands/role.ts
// CLI commands for RBAC role management

import { type Command } from 'commander';

import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';
import { formatDate, formatPaginationInfo } from '../lib/format-helpers.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../lib/command-context.js';

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
  items: Role[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
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
  tenant?: string;
  json?: boolean;
}

interface CreateOptions {
  tenant?: string;
  description?: string;
  permissions: string;
  json?: boolean;
}

interface UpdateOptions {
  tenant?: string;
  name?: string;
  description?: string;
  permissions?: string;
  json?: boolean;
}

interface DeleteOptions {
  tenant?: string;
  force?: boolean;
  json?: boolean;
}

interface RemoveRoleOptions {
  json?: boolean;
}

interface AssignOptions {
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Choose the right HTTP base path:
 *   - When the caller passes --tenant, target /v1/superadmin/roles (the
 *     cross-tenant superadmin surface) and forward tenantId as ?tenantId=.
 *   - Otherwise target /v1/roles (tenant principal, tenant from JWT).
 */
function rolesPath(tenantId: string | undefined, suffix = ''): string {
  const base = tenantId ? '/v1/superadmin/roles' : '/v1/roles';
  return base + suffix;
}

function withTenantQuery(tenantId: string | undefined, params: Record<string, string | undefined> = {}): string {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query[k] = v;
  }
  if (tenantId) query.tenantId = tenantId;
  const qs = new URLSearchParams(query).toString();
  return qs ? `?${qs}` : '';
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
  const spinner = output.spinner('Fetching roles...').start();

  try {
    const includeSystem = options.includeSystem !== undefined ? String(options.includeSystem) : undefined;
    const qs = withTenantQuery(options.tenant, { includeSystem });
    const response = await client.get<RoleListResponse>(rolesPath(options.tenant) + qs);
    spinner.stop();

    if (options.json) {
      output.json(response.items);
      return;
    }

    if (response.items.length === 0) {
      output.info('No roles found');
      return;
    }

    const table = new Table({
      head: ['ID', 'Name', 'System', 'Users', 'Permissions', 'Description'],
      colWidths: [38, 20, 8, 7, 30, 30],
      wordWrap: true,
    });

    for (const role of response.items) {
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
    output.info(formatPaginationInfo(response.pagination, 'role'));
  } catch (error) {
    spinner.fail('Failed to list roles');
    output.fatal(output.getErrorMessage(error));
  }
}

async function getRole(roleId: string, options: GetOptions): Promise<void> {
  const spinner = output.spinner('Fetching role...').start();

  try {
    const role = await client.get<Role>(rolesPath(options.tenant, `/${roleId}`) + withTenantQuery(options.tenant));
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
    output.fatal(output.getErrorMessage(error));
  }
}

async function createRole(name: string, options: CreateOptions): Promise<void> {
  if (!options.permissions) {
    output.error('Permissions are required. Use --permissions <perm1,perm2,...>');
    process.exit(1);
  }

  const spinner = output.spinner('Creating role...').start();

  try {
    const body: Record<string, unknown> = {
      name,
      permissions: options.permissions.split(',').map(p => p.trim()),
    };

    // For tenant-scoped /v1/roles the server reads tenant from JWT; we keep
    // tenantId on the body for backwards compatibility there. For the admin
    // surface tenantId is forwarded as a query parameter.
    if (options.tenant) body.tenantId = options.tenant;
    if (options.description) body.description = options.description;

    const result = await client.post<Role>(rolesPath(options.tenant) + withTenantQuery(options.tenant), body);
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
  const spinner = output.spinner('Fetching role...').start();

  try {
    const current = await client.get<Role>(rolesPath(options.tenant, `/${roleId}`) + withTenantQuery(options.tenant));
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

    const updateSpinner = output.spinner('Updating role...').start();
    const result = await client.patch<Role>(rolesPath(options.tenant, `/${roleId}`) + withTenantQuery(options.tenant), body);
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
    const spinner = output.spinner('Fetching role...').start();
    try {
      const role = await client.get<Role>(rolesPath(options.tenant, `/${roleId}`) + withTenantQuery(options.tenant));
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

  const deleteSpinner = output.spinner('Deleting role...').start();

  try {
    await client.delete(rolesPath(options.tenant, `/${roleId}`) + withTenantQuery(options.tenant));
    deleteSpinner.stop();

    if (options.json) {
      output.json({ success: true, roleId });
      return;
    }

    output.success('Role deleted successfully');
  } catch (error) {
    deleteSpinner.fail('Failed to delete role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function assignRole(roleId: string, userId: string, options: AssignOptions): Promise<void> {
  const spinner = output.spinner('Assigning role...').start();

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

async function removeRole(roleId: string, userId: string, options: RemoveRoleOptions): Promise<void> {
  const spinner = output.spinner('Removing role...').start();

  try {
    await client.delete(`/v1/users/${userId}/roles/${roleId}`);
    spinner.stop();

    if (options.json) {
      output.json({ success: true, roleId, userId });
      return;
    }

    output.success(`Role ${roleId} removed from user ${userId}`);
  } catch (error) {
    spinner.fail('Failed to remove role');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getUserRoles(userId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching user roles...').start();

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
  const spinner = output.spinner('Fetching user permissions...').start();

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

export function registerRoleCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  withRegisterContext(ctx, () => { registerRoleCommandsInner(parent, ctx); });
}

function registerRoleCommandsInner(parent: Command, ctx: 'tenant' | 'superadmin'): void {
  const role = parent
    .command('role')
    .description('RBAC role management');

  // Helper: only register --tenant in superadmin context
  const t = (cmd: Command, desc: string): Command =>
    ctx === 'superadmin' ? cmd.option('-t, --tenant <id>', desc) : cmd;

  // List roles
  {
    const listCmd = role
      .command('list')
      .description('List all roles');
    t(listCmd, 'Filter by tenant');
    listCmd
      .option('--include-system', 'Include system roles (default: true)')
      .option('--no-include-system', 'Exclude system roles')
      .option('--json', 'Output as JSON')
      .action(listRoles);
  }

  // Get role
  {
    const getCmd = role
      .command('get <roleId>')
      .description('Get role details');
    t(getCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/roles)');
    getCmd
      .option('--json', 'Output as JSON')
      .action(getRole);
  }

  // Create role
  {
    const createCmd = role
      .command('create <name>')
      .description('Create a custom role');
    t(createCmd, 'Tenant ID (optional, creates system role if not specified)');
    createCmd
      .option('-d, --description <desc>', 'Role description')
      .requiredOption('-p, --permissions <perms>', 'Comma-separated permissions')
      .option('--json', 'Output as JSON')
      .action(createRole);
  }

  // Update role
  {
    const updateCmd = role
      .command('update <roleId>')
      .description('Update a custom role');
    t(updateCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/roles)');
    updateCmd
      .option('-n, --name <name>', 'New role name')
      .option('-d, --description <desc>', 'New description')
      .option('-p, --permissions <perms>', 'New permissions (comma-separated)')
      .option('--json', 'Output as JSON')
      .action(updateRole);
  }

  // Delete role
  {
    const deleteCmd = role
      .command('delete <roleId>')
      .description('Delete a custom role');
    t(deleteCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/roles)');
    deleteCmd
      .option('-f, --force', 'Skip confirmation')
      .option('--json', 'Output as JSON')
      .action(deleteRole);
  }

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
    .option('--json', 'Output as JSON')
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
