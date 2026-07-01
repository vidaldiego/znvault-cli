// Path: src/commands/dynamic-secrets/role.ts

/**
 * Role commands for dynamic secrets
 */


import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DbRole, RoleCreateOptions, RoleUpdateOptions } from './types.js';
import { formatDate, formatTtl } from './helpers.js';

export async function listRoles(options: { connection?: string; json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching roles...').start();

  try {
    let url = '/v1/dynamic-secrets/roles';
    if (options.connection) {
      url = `/v1/dynamic-secrets/connections/${options.connection}/roles`;
    }

    const response = await client.get<DbRole[]>(url);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.length === 0) {
      output.info('No roles found.');
      return;
    }

    const table = new Table({
      head: ['Name', 'Connection', 'Enabled', 'Default TTL', 'Max TTL', 'Active Leases'],
      style: { head: ['cyan'] },
    });

    for (const role of response) {
      table.push([
        role.name,
        role.connectionName ?? role.connectionId.substring(0, 8),
        role.isEnabled ? 'Yes' : 'No',
        formatTtl(role.defaultTtlSeconds),
        formatTtl(role.maxTtlSeconds),
        String(role.activeLeases ?? 0),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.length} role(s) found`);
  } catch (err) {
    spinner.fail('Failed to list roles');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getRole(roleId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching role...').start();

  try {
    const response = await client.get<DbRole>(`/v1/dynamic-secrets/roles/${roleId}`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Name': response.name,
      'Description': response.description ?? '-',
      'Connection': response.connectionName ?? response.connectionId,
      'Enabled': response.isEnabled ? 'Yes' : 'No',
      'Username Template': response.usernameTemplate,
      'Default TTL': formatTtl(response.defaultTtlSeconds),
      'Max TTL': formatTtl(response.maxTtlSeconds),
      'Active Leases': String(response.activeLeases ?? 0),
      'Created': formatDate(response.createdAt),
      'Updated': formatDate(response.updatedAt),
    });
  } catch (err) {
    spinner.fail('Failed to get role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function createRole(connectionId: string, options: RoleCreateOptions): Promise<void> {
  // Interactive prompts if options not provided
  const name = options.name ?? (await inquirer.prompt<{ name: string }>([{
    type: 'input',
    name: 'name',
    message: 'Role name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const creationStatements = options.creationStatements?.split(';').filter(s => s.trim()) ??
    (await inquirer.prompt<{ statements: string }>([{
      type: 'editor',
      name: 'statements',
      message: 'Creation SQL statements (one per line, use {{username}} and {{password}} placeholders):',
    }])).statements.split('\n').filter(s => s.trim());

  const revocationStatements = options.revocationStatements?.split(';').filter(s => s.trim()) ??
    (await inquirer.prompt<{ statements: string }>([{
      type: 'editor',
      name: 'statements',
      message: 'Revocation SQL statements (one per line, use {{username}} placeholder):',
    }])).statements.split('\n').filter(s => s.trim());

  const spinner = output.spinner('Creating role...').start();

  try {
    const body: Record<string, unknown> = {
      name,
      creationStatements,
      revocationStatements,
    };

    if (options.description) body.description = options.description;
    if (options.renewStatements) body.renewStatements = options.renewStatements.split(';').filter(s => s.trim());
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);
    if (options.usernameTemplate) body.usernameTemplate = options.usernameTemplate;

    const response = await client.post<DbRole>(`/v1/dynamic-secrets/connections/${connectionId}/roles`, body);
    spinner.succeed('Role created');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Role "${response.name}" created with ID: ${response.id}`);
    }
  } catch (err) {
    spinner.fail('Failed to create role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function updateRole(roleId: string, options: RoleUpdateOptions): Promise<void> {
  const spinner = output.spinner('Updating role...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.description !== undefined) body.description = options.description;
    if (options.creationStatements) body.creationStatements = options.creationStatements.split(';').filter(s => s.trim());
    if (options.revocationStatements) body.revocationStatements = options.revocationStatements.split(';').filter(s => s.trim());
    if (options.renewStatements) body.renewStatements = options.renewStatements.split(';').filter(s => s.trim());
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);
    if (options.enabled !== undefined) body.isEnabled = options.enabled === 'true';

    const response = await client.patch<DbRole>(`/v1/dynamic-secrets/roles/${roleId}`, body);
    spinner.succeed('Role updated');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Role "${response.name}" updated`);
    }
  } catch (err) {
    spinner.fail('Failed to update role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteRole(roleId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete this role? Active leases will be revoked.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = output.spinner('Deleting role...').start();

  try {
    await client.delete(`/v1/dynamic-secrets/roles/${roleId}`);
    spinner.succeed('Role deleted');

    if (options.json) {
      output.json({ success: true, roleId });
    }
  } catch (err) {
    spinner.fail('Failed to delete role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
