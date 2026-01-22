// Path: src/commands/dynamic-secrets/connection.ts

/**
 * Connection commands for dynamic secrets
 */

import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DbConnection, TestConnectionResult, ConnectionCreateOptions, ConnectionUpdateOptions } from './types.js';
import { formatStatus, formatDate, formatTtl } from './helpers.js';

export async function listConnections(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching connections...').start();

  try {
    const response = await client.get<DbConnection[]>('/v1/dynamic-secrets/connections');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.length === 0) {
      output.info('No database connections found.');
      return;
    }

    const table = new Table({
      head: ['Name', 'Type', 'Status', 'Default TTL', 'Max TTL', 'Roles', 'Active Leases'],
      style: { head: ['cyan'] },
    });

    for (const conn of response) {
      table.push([
        conn.name,
        conn.connectionType,
        formatStatus(conn.status),
        formatTtl(conn.defaultTtlSeconds),
        formatTtl(conn.maxTtlSeconds),
        String(conn.roleCount ?? 0),
        String(conn.activeLeases ?? 0),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.length} connection(s) found`);
  } catch (err) {
    spinner.fail('Failed to list connections');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getConnection(nameOrId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching connection...').start();

  try {
    const response = await client.get<DbConnection>(`/v1/dynamic-secrets/connections/${nameOrId}`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Name': response.name,
      'Description': response.description ?? '-',
      'Type': response.connectionType,
      'Status': formatStatus(response.status),
      'Max Connections': response.maxOpenConnections,
      'Timeout': `${response.connectionTimeoutSeconds}s`,
      'Default TTL': formatTtl(response.defaultTtlSeconds),
      'Max TTL': formatTtl(response.maxTtlSeconds),
      'Last Health Check': formatDate(response.lastHealthCheck),
      'Health Status': response.lastHealthCheckStatus === null ? '-' : (response.lastHealthCheckStatus ? 'Healthy' : 'Unhealthy'),
      'Roles': String(response.roleCount ?? 0),
      'Active Leases': String(response.activeLeases ?? 0),
      'Created': formatDate(response.createdAt),
      'Updated': formatDate(response.updatedAt),
    });
  } catch (err) {
    spinner.fail('Failed to get connection');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function createConnection(options: ConnectionCreateOptions): Promise<void> {
  // Interactive prompts if options not provided
  const name = options.name ?? (await inquirer.prompt<{ name: string }>([{
    type: 'input',
    name: 'name',
    message: 'Connection name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const connectionType = options.type?.toUpperCase() ?? (await inquirer.prompt<{ type: string }>([{
    type: 'list',
    name: 'type',
    message: 'Database type:',
    choices: ['POSTGRESQL', 'MYSQL'],
  }])).type;

  const connectionString = options.connectionString ?? (await inquirer.prompt<{ connectionString: string }>([{
    type: 'password',
    name: 'connectionString',
    message: 'Connection string:',
    mask: '*',
    validate: (input: string) => input.trim() ? true : 'Connection string is required',
  }])).connectionString;

  const spinner = ora('Creating connection...').start();

  try {
    const body: Record<string, unknown> = {
      name,
      connectionType,
      connectionString,
    };

    if (options.description) body.description = options.description;
    if (options.maxConnections) body.maxOpenConnections = parseInt(options.maxConnections, 10);
    if (options.timeout) body.connectionTimeoutSeconds = parseInt(options.timeout, 10);
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);

    const response = await client.post<DbConnection>('/v1/dynamic-secrets/connections', body);
    spinner.succeed('Connection created');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Connection "${response.name}" created with ID: ${response.id}`);
    }
  } catch (err) {
    spinner.fail('Failed to create connection');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function updateConnection(nameOrId: string, options: ConnectionUpdateOptions): Promise<void> {
  const spinner = ora('Updating connection...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.description !== undefined) body.description = options.description;
    if (options.maxConnections) body.maxOpenConnections = parseInt(options.maxConnections, 10);
    if (options.timeout) body.connectionTimeoutSeconds = parseInt(options.timeout, 10);
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);
    if (options.status) body.status = options.status.toUpperCase();

    const response = await client.patch<DbConnection>(`/v1/dynamic-secrets/connections/${nameOrId}`, body);
    spinner.succeed('Connection updated');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Connection "${response.name}" updated`);
    }
  } catch (err) {
    spinner.fail('Failed to update connection');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteConnection(nameOrId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete connection "${nameOrId}"? This will also delete all associated roles.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = ora('Deleting connection...').start();

  try {
    await client.delete(`/v1/dynamic-secrets/connections/${nameOrId}`);
    spinner.succeed(`Connection "${nameOrId}" deleted`);

    if (options.json) {
      output.json({ success: true, id: nameOrId });
    }
  } catch (err) {
    spinner.fail('Failed to delete connection');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function testConnection(nameOrId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Testing connection...').start();

  try {
    const response = await client.post<TestConnectionResult>(`/v1/dynamic-secrets/connections/${nameOrId}/test`, {});

    if (response.success) {
      spinner.succeed('Connection test successful');
      if (options.json) {
        output.json(response);
      }
    } else {
      spinner.fail('Connection test failed');
      output.error(response.error ?? 'Unknown error');
      if (options.json) {
        output.json(response);
      }
      process.exit(1);
    }
  } catch (err) {
    spinner.fail('Failed to test connection');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
