// Path: src/commands/dynamic-secrets/index.ts

/**
 * Dynamic secrets command registration
 */

import { type Command } from 'commander';
import {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
} from './connection.js';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
} from './role.js';
import { generateCredentials } from './creds.js';
import {
  listLeases,
  getLease,
  renewLease,
  revokeLease,
} from './lease.js';
import { registerAllowedHostsCommands } from './allowed-hosts.js';

// Re-export types
export * from './types.js';

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

  // -------------------------------------------------------------------------
  // Allowed-Hosts Commands
  // -------------------------------------------------------------------------
  registerAllowedHostsCommands(dynasec);
}
