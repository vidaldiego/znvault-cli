// Path: znvault-cli/src/commands/dynamic-secrets.ts
// CLI commands for dynamic secrets management (on-demand database credentials)

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface DbConnection {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  connectionType: 'POSTGRESQL' | 'MYSQL';
  maxOpenConnections: number;
  connectionTimeoutSeconds: number;
  status: 'ACTIVE' | 'DISABLED' | 'FAILED' | 'TESTING';
  lastHealthCheck: string | null;
  lastHealthCheckStatus: boolean | null;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  roleCount?: number;
  activeLeases?: number;
}

interface DbRole {
  id: string;
  tenantId: string;
  connectionId: string;
  connectionName?: string;
  name: string;
  description: string | null;
  defaultTtlSeconds: number | null;
  maxTtlSeconds: number | null;
  usernameTemplate: string;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  activeLeases?: number;
}

interface DbLease {
  id: string;
  tenantId: string;
  connectionId: string;
  connectionName?: string;
  roleId: string;
  roleName?: string;
  username: string;
  issuedAt: string;
  expiresAt: string;
  lastRenewedAt: string | null;
  renewalCount: number;
  maxExpiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'FAILED';
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  ttlRemaining: number;
}

interface GeneratedCredential {
  leaseId: string;
  username: string;
  password: string;
  expiresAt: string;
  maxExpiresAt: string;
  ttlSeconds: number;
  renewalCount: number;
}

interface TestConnectionResult {
  success: boolean;
  error?: string;
}

interface RenewalResult {
  leaseId: string;
  expiresAt: string;
  renewalCount: number;
  ttlSeconds: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'ACTIVE': return output.isPlainMode() ? 'ACTIVE' : '\x1b[32mACTIVE\x1b[0m';
    case 'DISABLED': return output.isPlainMode() ? 'DISABLED' : '\x1b[33mDISABLED\x1b[0m';
    case 'FAILED': return output.isPlainMode() ? 'FAILED' : '\x1b[31mFAILED\x1b[0m';
    case 'TESTING': return output.isPlainMode() ? 'TESTING' : '\x1b[36mTESTING\x1b[0m';
    case 'EXPIRED': return output.isPlainMode() ? 'EXPIRED' : '\x1b[33mEXPIRED\x1b[0m';
    case 'REVOKED': return output.isPlainMode() ? 'REVOKED' : '\x1b[31mREVOKED\x1b[0m';
    default: return status;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'inherit';
  return formatDuration(seconds);
}

// ============================================================================
// Connection Commands
// ============================================================================

async function listConnections(options: { json?: boolean }): Promise<void> {
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

async function getConnection(nameOrId: string, options: { json?: boolean }): Promise<void> {
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
      'Description': response.description || '-',
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

async function createConnection(options: {
  name?: string;
  type?: string;
  connectionString?: string;
  description?: string;
  maxConnections?: string;
  timeout?: string;
  defaultTtl?: string;
  maxTtl?: string;
  json?: boolean;
}): Promise<void> {
  // Interactive prompts if options not provided
  const name = options.name || (await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Connection name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const connectionType = options.type?.toUpperCase() || (await inquirer.prompt([{
    type: 'list',
    name: 'type',
    message: 'Database type:',
    choices: ['POSTGRESQL', 'MYSQL'],
  }])).type;

  const connectionString = options.connectionString || (await inquirer.prompt([{
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

async function updateConnection(nameOrId: string, options: {
  description?: string;
  maxConnections?: string;
  timeout?: string;
  defaultTtl?: string;
  maxTtl?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
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

async function deleteConnection(nameOrId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt([{
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

async function testConnection(nameOrId: string, options: { json?: boolean }): Promise<void> {
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
      output.error(response.error || 'Unknown error');
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

// ============================================================================
// Role Commands
// ============================================================================

async function listRoles(options: { connection?: string; json?: boolean }): Promise<void> {
  const spinner = ora('Fetching roles...').start();

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
        role.connectionName || role.connectionId.substring(0, 8),
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

async function getRole(roleId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching role...').start();

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
      'Description': response.description || '-',
      'Connection': response.connectionName || response.connectionId,
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

async function createRole(connectionId: string, options: {
  name?: string;
  description?: string;
  creationStatements?: string;
  revocationStatements?: string;
  renewStatements?: string;
  defaultTtl?: string;
  maxTtl?: string;
  usernameTemplate?: string;
  json?: boolean;
}): Promise<void> {
  // Interactive prompts if options not provided
  const name = options.name || (await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Role name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const creationStatements = options.creationStatements?.split(';').filter(s => s.trim()) || (await inquirer.prompt([{
    type: 'editor',
    name: 'statements',
    message: 'Creation SQL statements (one per line, use {{username}} and {{password}} placeholders):',
  }])).statements.split('\n').filter((s: string) => s.trim());

  const revocationStatements = options.revocationStatements?.split(';').filter(s => s.trim()) || (await inquirer.prompt([{
    type: 'editor',
    name: 'statements',
    message: 'Revocation SQL statements (one per line, use {{username}} placeholder):',
  }])).statements.split('\n').filter((s: string) => s.trim());

  const spinner = ora('Creating role...').start();

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

async function updateRole(roleId: string, options: {
  description?: string;
  defaultTtl?: string;
  maxTtl?: string;
  enabled?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = ora('Updating role...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.description !== undefined) body.description = options.description;
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

async function deleteRole(roleId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt([{
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

  const spinner = ora('Deleting role...').start();

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

// ============================================================================
// Credential Commands
// ============================================================================

async function generateCredentials(roleId: string, options: {
  ttl?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = ora('Generating credentials...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.ttl) body.ttlSeconds = parseInt(options.ttl, 10);

    const response = await client.post<GeneratedCredential>(`/v1/dynamic-secrets/roles/${roleId}/credentials`, body);
    spinner.succeed('Credentials generated');

    if (options.json) {
      output.json(response);
      return;
    }

    console.log('');
    output.keyValue({
      'Lease ID': response.leaseId,
      'Username': response.username,
      'Password': response.password,
      'TTL': formatDuration(response.ttlSeconds),
      'Expires At': formatDate(response.expiresAt),
      'Max Expires At': formatDate(response.maxExpiresAt),
    });

    console.log('');
    output.warn('The password is shown only once. Store it securely or use it immediately.');
  } catch (err) {
    spinner.fail('Failed to generate credentials');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Lease Commands
// ============================================================================

async function listLeases(options: {
  role?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = ora('Fetching leases...').start();

  try {
    const params = new URLSearchParams();
    if (options.role) params.append('roleId', options.role);
    if (options.status) params.append('status', options.status.toUpperCase());

    const url = `/v1/dynamic-secrets/leases${params.toString() ? '?' + params.toString() : ''}`;
    const response = await client.get<DbLease[]>(url);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.length === 0) {
      output.info('No leases found.');
      return;
    }

    const table = new Table({
      head: ['Lease ID', 'Username', 'Role', 'Status', 'TTL Remaining', 'Renewals'],
      style: { head: ['cyan'] },
    });

    for (const lease of response) {
      table.push([
        lease.id.substring(0, 12),
        lease.username,
        lease.roleName || lease.roleId.substring(0, 8),
        formatStatus(lease.status),
        lease.status === 'ACTIVE' ? formatDuration(lease.ttlRemaining) : '-',
        String(lease.renewalCount),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.length} lease(s) found`);
  } catch (err) {
    spinner.fail('Failed to list leases');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function getLease(leaseId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching lease...').start();

  try {
    const response = await client.get<DbLease>(`/v1/dynamic-secrets/leases/${leaseId}`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'Lease ID': response.id,
      'Username': response.username,
      'Role': response.roleName || response.roleId,
      'Connection': response.connectionName || response.connectionId,
      'Status': formatStatus(response.status),
      'TTL Remaining': response.status === 'ACTIVE' ? formatDuration(response.ttlRemaining) : '-',
      'Renewal Count': String(response.renewalCount),
      'Issued At': formatDate(response.issuedAt),
      'Expires At': formatDate(response.expiresAt),
      'Max Expires At': formatDate(response.maxExpiresAt),
      'Last Renewed': formatDate(response.lastRenewedAt),
      'Revoked At': formatDate(response.revokedAt),
      'Revoked By': response.revokedBy || '-',
      'Revoke Reason': response.revokeReason || '-',
    });
  } catch (err) {
    spinner.fail('Failed to get lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function renewLease(leaseId: string, options: {
  ttl?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = ora('Renewing lease...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.ttl) body.ttlSeconds = parseInt(options.ttl, 10);

    const response = await client.post<RenewalResult>(
      `/v1/dynamic-secrets/leases/${leaseId}/renew`,
      body
    );
    spinner.succeed('Lease renewed');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Lease renewed. New TTL: ${formatDuration(response.ttlSeconds)}, Renewal count: ${response.renewalCount}`);
    }
  } catch (err) {
    spinner.fail('Failed to renew lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function revokeLease(leaseId: string, options: {
  reason?: string;
  force?: boolean;
  json?: boolean;
}): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to revoke lease "${leaseId}"? This will immediately revoke the database credentials.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = ora('Revoking lease...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.reason) body.reason = options.reason;

    await client.post(`/v1/dynamic-secrets/leases/${leaseId}/revoke`, body);
    spinner.succeed('Lease revoked');

    if (options.json) {
      output.json({ success: true, leaseId });
    }
  } catch (err) {
    spinner.fail('Failed to revoke lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerDynamicSecretsCommands(program: Command): void {
  const dynasec = program
    .command('dynasec')
    .description('Dynamic secrets management (on-demand database credentials)')
    .addHelpText('after', `
Examples:
  # List all database connections
  znvault dynasec connection list

  # Create a PostgreSQL connection
  znvault dynasec connection create --name my-pg --type postgresql \\
    --connection-string "postgresql://admin:pass@localhost:5432/mydb"

  # Create a role for the connection
  znvault dynasec role create <connection-id> --name readonly \\
    --creation-statements "CREATE ROLE \\"{{username}}\\" WITH LOGIN PASSWORD '{{password}}'" \\
    --revocation-statements "DROP ROLE IF EXISTS \\"{{username}}\\""

  # Generate credentials
  znvault dynasec creds generate <role-id> --ttl 3600

  # List active leases
  znvault dynasec lease list --status active

  # Revoke a lease
  znvault dynasec lease revoke <lease-id> --reason "No longer needed"
`);

  // -------------------------------------------------------------------------
  // Connection Commands
  // -------------------------------------------------------------------------
  const connection = dynasec.command('connection').alias('conn').description('Manage database connections');

  connection
    .command('list')
    .alias('ls')
    .description('List all database connections')
    .option('--json', 'Output as JSON')
    .action(listConnections);

  connection
    .command('get <name-or-id>')
    .description('Get connection details')
    .option('--json', 'Output as JSON')
    .action(getConnection);

  connection
    .command('create')
    .description('Create a new database connection')
    .option('--name <name>', 'Connection name')
    .option('--type <type>', 'Database type (POSTGRESQL or MYSQL)')
    .option('--connection-string <string>', 'Database connection string')
    .option('--description <desc>', 'Connection description')
    .option('--max-connections <n>', 'Maximum open connections')
    .option('--timeout <seconds>', 'Connection timeout in seconds')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--json', 'Output as JSON')
    .action(createConnection);

  connection
    .command('update <name-or-id>')
    .description('Update a database connection')
    .option('--description <desc>', 'Connection description')
    .option('--max-connections <n>', 'Maximum open connections')
    .option('--timeout <seconds>', 'Connection timeout in seconds')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--status <status>', 'Connection status (ACTIVE or DISABLED)')
    .option('--json', 'Output as JSON')
    .action(updateConnection);

  connection
    .command('delete <name-or-id>')
    .alias('rm')
    .description('Delete a database connection')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteConnection);

  connection
    .command('test <name-or-id>')
    .description('Test a database connection')
    .option('--json', 'Output as JSON')
    .action(testConnection);

  // -------------------------------------------------------------------------
  // Role Commands
  // -------------------------------------------------------------------------
  const role = dynasec.command('role').description('Manage credential roles');

  role
    .command('list')
    .alias('ls')
    .description('List all roles')
    .option('--connection <id>', 'Filter by connection ID')
    .option('--json', 'Output as JSON')
    .action(listRoles);

  role
    .command('get <role-id>')
    .description('Get role details')
    .option('--json', 'Output as JSON')
    .action(getRole);

  role
    .command('create <connection-id>')
    .description('Create a new role for a connection')
    .option('--name <name>', 'Role name')
    .option('--description <desc>', 'Role description')
    .option('--creation-statements <sql>', 'SQL statements to create credentials (semicolon-separated)')
    .option('--revocation-statements <sql>', 'SQL statements to revoke credentials (semicolon-separated)')
    .option('--renew-statements <sql>', 'SQL statements to renew credentials (semicolon-separated)')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--username-template <template>', 'Username template (e.g., v_{{role}}_{{random:8}})')
    .option('--json', 'Output as JSON')
    .action(createRole);

  role
    .command('update <role-id>')
    .description('Update a role')
    .option('--description <desc>', 'Role description')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--enabled <bool>', 'Enable or disable role (true/false)')
    .option('--json', 'Output as JSON')
    .action(updateRole);

  role
    .command('delete <role-id>')
    .alias('rm')
    .description('Delete a role')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteRole);

  // -------------------------------------------------------------------------
  // Credentials Commands
  // -------------------------------------------------------------------------
  const creds = dynasec.command('creds').alias('credentials').description('Generate database credentials');

  creds
    .command('generate <role-id>')
    .alias('gen')
    .description('Generate new database credentials')
    .option('--ttl <seconds>', 'Credential TTL in seconds')
    .option('--json', 'Output as JSON')
    .action(generateCredentials);

  // -------------------------------------------------------------------------
  // Lease Commands
  // -------------------------------------------------------------------------
  const lease = dynasec.command('lease').description('Manage credential leases');

  lease
    .command('list')
    .alias('ls')
    .description('List credential leases')
    .option('--role <id>', 'Filter by role ID')
    .option('--status <status>', 'Filter by status (ACTIVE, EXPIRED, REVOKED)')
    .option('--json', 'Output as JSON')
    .action(listLeases);

  lease
    .command('get <lease-id>')
    .description('Get lease details')
    .option('--json', 'Output as JSON')
    .action(getLease);

  lease
    .command('renew <lease-id>')
    .description('Renew a lease')
    .option('--ttl <seconds>', 'New TTL in seconds')
    .option('--json', 'Output as JSON')
    .action(renewLease);

  lease
    .command('revoke <lease-id>')
    .description('Revoke a lease (immediately revokes database credentials)')
    .option('--reason <reason>', 'Revocation reason')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(revokeLease);
}
