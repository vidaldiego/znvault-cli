// Path: src/commands/dynamic-secrets/connection.ts

/**
 * Connection commands for dynamic secrets
 */


import * as fs from 'node:fs';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  DbConnection,
  TestConnectionResult,
  ConnectionCreateOptions,
  ConnectionUpdateOptions,
  ConnectionProvisionOptions,
  ProvisionReport,
  RotateAdminResult,
} from './types.js';
import { formatStatus, formatDate, formatTtl } from './helpers.js';

export async function listConnections(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching connections...').start();

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
  const spinner = output.spinner('Fetching connection...').start();

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

  const spinner = output.spinner('Creating connection...').start();

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
  const spinner = output.spinner('Updating connection...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.description !== undefined) body.description = options.description;
    if (options.maxConnections) body.maxOpenConnections = parseInt(options.maxConnections, 10);
    if (options.timeout) body.connectionTimeoutSeconds = parseInt(options.timeout, 10);
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);
    if (options.status) body.status = options.status.toUpperCase();
    if (options.routinesConnectionString) body.routinesConnectionString = options.routinesConnectionString;

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
      message: `Are you sure you want to delete connection "${nameOrId}"? This will also delete its roles, but only when no retained lease history exists.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = output.spinner('Deleting connection...').start();

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

/**
 * Read the root (superuser) connection string for `provision`.
 *
 * LOAD-BEARING: the root credential is NEVER accepted as an inline CLI flag —
 * argv is visible to every other process on the host via `ps`/`/proc`, and is
 * frequently persisted in shell history. The only two supported input paths
 * are:
 *   1. `--root-file <path>` — a file the operator writes out-of-band (e.g.
 *      `read -s`'d into a file, or piped from another secrets tool) and
 *      ideally deletes afterward. Read once, synchronously, and never
 *      written back anywhere.
 *   2. A masked interactive prompt (inquirer `type: 'password'`) when
 *      `--root-file` is omitted — nothing is echoed to the terminal and
 *      nothing touches argv.
 *
 * The returned string is held in memory only for the duration of the POST.
 */
async function readRootConnectionString(rootFile: string | undefined): Promise<string> {
  if (rootFile) {
    let raw: string;
    try {
      raw = fs.readFileSync(rootFile, 'utf8');
    } catch (err) {
      output.error(`Failed to read --root-file "${rootFile}": ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      output.error(`--root-file "${rootFile}" is empty`);
      process.exit(1);
    }
    return trimmed;
  }

  const { rootConnectionString } = await inquirer.prompt<{ rootConnectionString: string }>([{
    type: 'password',
    name: 'rootConnectionString',
    message: 'Root (superuser) connection string:',
    mask: '*',
    validate: (input: string) => input.trim() ? true : 'Root connection string is required',
  }]);
  return rootConnectionString.trim();
}

/**
 * Print a per-step provisioning report. Each step carries at minimum
 * `{ step, status }`; any additional fields (e.g. `detail`, `username`) are
 * rendered too, but credentials never appear here — the server-side
 * ProvisionReport contract guarantees no secret material is included.
 */
function printProvisionReport(report: ProvisionReport): void {
  const table = new Table({
    head: ['Step', 'Status', 'Detail'],
    style: { head: ['cyan'] },
  });

  for (const s of report.steps) {
    const { step, status: stepStatus, ...rest } = s;
    const detailEntries = Object.entries(rest).filter(([, v]) => v !== undefined);
    const detail = detailEntries.length > 0
      ? detailEntries.map(([k, v]) => `${k}=${String(v)}`).join(', ')
      : '-';
    table.push([step, stepStatus, detail]);
  }

  console.log(table.toString());
}

export async function provisionConnection(name: string, options: ConnectionProvisionOptions): Promise<void> {
  if (!options.type) {
    output.error('--type is required (mysql or postgresql)');
    process.exit(1);
  }

  const connectionType = options.type.toUpperCase();
  if (connectionType !== 'MYSQL' && connectionType !== 'POSTGRESQL') {
    output.error(`Invalid --type "${options.type}": must be "mysql" or "postgresql"`);
    process.exit(1);
  }

  if (options.routinesBundle && !options.routinesVersion) {
    output.error('--routines-version is required when --routines-bundle is given');
    process.exit(1);
  }
  if (options.routinesVersion && !options.routinesBundle) {
    output.error('--routines-bundle is required when --routines-version is given');
    process.exit(1);
  }

  let routinesVersion: number | undefined;
  if (options.routinesVersion) {
    routinesVersion = parseInt(options.routinesVersion, 10);
    if (!Number.isInteger(routinesVersion) || routinesVersion < 1) {
      output.error('--routines-version must be a positive integer');
      process.exit(1);
    }
  }

  // Read the root credential BEFORE starting the spinner — an interactive
  // masked prompt and an ora spinner fight over the same terminal line.
  const rootConnectionString = await readRootConnectionString(options.rootFile);

  const spinner = output.spinner('Provisioning connection...').start();

  try {
    const body: Record<string, unknown> = {
      name,
      connectionType,
      rootConnectionString,
    };
    if (options.accountPrefix) body.accountPrefix = options.accountPrefix;
    if (options.routinesBundle && routinesVersion) {
      body.routines = { bundle: options.routinesBundle, version: routinesVersion };
    }

    const response = await client.post<ProvisionReport>('/v1/dynamic-secrets/connections/provision', body);
    spinner.succeed(`Connection "${response.name}" provisioned`);

    if (options.json) {
      output.json(response);
      return;
    }

    printProvisionReport(response);
    output.success(
      `Connection "${response.name}" (${response.connectionId}) provisioned=${String(response.provisioned)}`,
    );
  } catch (err) {
    spinner.fail('Failed to provision connection');
    output.error(err instanceof Error ? err.message : String(err));

    // Some provision failures (422 root_insufficient, 502 provision_failed /
    // routines_apply_failed) include a partial `steps` report showing where
    // the process stopped. The shared HTTP client (src/lib/client/http.ts)
    // attaches the parsed error body's `steps`/`error` fields to the thrown
    // Error, so render that partial report here when present; otherwise
    // fall back to pointing at `dynasec connection get` for post-mortem state.
    const errDetails = err as { statusCode?: number; errorCode?: string; steps?: ProvisionReport['steps'] } | null;
    if (errDetails?.steps !== undefined && errDetails.steps.length > 0) {
      printProvisionReport({ connectionId: '', name, steps: errDetails.steps, provisioned: false });
    } else if (errDetails?.statusCode !== undefined) {
      output.info(`Server responded with HTTP ${errDetails.statusCode}. Run "znvault dynasec connection get ${name}" to check partial state.`);
    }

    process.exit(1);
  }
}

export async function rotateAdminCredential(id: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Rotating admin credential...').start();

  try {
    const response = await client.post<RotateAdminResult>(`/v1/dynamic-secrets/connections/${id}/rotate-admin`, {});
    spinner.succeed('Admin credential rotated');

    if (options.json) {
      output.json(response);
      return;
    }

    output.success(`Admin credential rotated for connection ${id} (rotated=${String(response.rotated)})`);
  } catch (err) {
    spinner.fail('Failed to rotate admin credential');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function testConnection(nameOrId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Testing connection...').start();

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
