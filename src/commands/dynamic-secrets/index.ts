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
  provisionConnection,
  rotateAdminCredential,
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
import { registerTemplatesCommands } from './templates.js';
import {
  getMintOperationStatus,
  issueMintPermit,
  lookupMintPermit,
  revokeMintOperation,
} from './permit.js';
import {
  closeRecoveryFence,
  getRecoveryFenceStatus,
  openRecoveryFence,
} from './recovery-fence.js';

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
    .option('--routines-connection-string <string>', 'Write-only credential for the persistent "routines" sub-account (rotating = re-setting; never returned in any response)')
    .option('--json', 'Output as JSON')
    .action(updateConnection);

  connection
    .command('delete <name-or-id>')
    .alias('rm')
    .description('Delete a database connection (blocked while retained lease history exists)')
    .option('--force', 'Skip confirmation only; does not bypass lease-history retention')
    .option('--json', 'Output as JSON')
    .action(deleteConnection);

  connection
    .command('test <name-or-id>')
    .description('Test a database connection')
    .option('--json', 'Output as JSON')
    .action(testConnection);

  connection
    .command('provision <name>')
    .description(
      'Provision a database connection end-to-end: validates the root credential, creates ' +
      'least-privilege sub-accounts server-side, and stores the connection. Pre-existing reserved ' +
      'accounts are rejected without mutation. ' +
      'The root credential is transient — read from --root-file or a masked prompt, sent once, ' +
      'never persisted or logged.',
    )
    .option('--type <type>', 'Database type: mysql or postgresql (required)')
    .option(
      '--root-file <path>',
      'Path to a file containing the root/superuser connection string. If omitted, you will be ' +
      'prompted interactively with masked input. NEVER pass the root credential as an inline flag — ' +
      'command-line arguments are visible to other processes via `ps` and are often saved to shell history.',
    )
    .option('--account-prefix <prefix>', 'Optional prefix for the generated admin/routines account usernames')
    .option('--routines-bundle <name>', 'MySQL only: name of a shipped routine bundle to apply (requires --routines-version)')
    .option('--routines-version <n>', 'MySQL only: version of the routine bundle to apply (requires --routines-bundle)')
    .option('--json', 'Output the raw ProvisionReport as JSON')
    .addHelpText('after', `
Examples:
  # Provision a MySQL connection, reading the root credential from a file
  # (write it out-of-band, e.g. \`read -s ROOT && echo -n "$ROOT" > /tmp/root.txt\`,
  # then delete the file once provisioning succeeds):
  znvault dynasec connection provision my-mysql --type mysql \\
    --root-file /tmp/root.txt

  # Same, but prompted interactively instead of using a file (masked input,
  # nothing written to disk or shell history):
  znvault dynasec connection provision my-mysql --type mysql
  # -> Root (superuser) connection string: ****************

  # PostgreSQL connection (routines are MySQL-only; omit --routines-*):
  znvault dynasec connection provision my-pg --type postgresql \\
    --root-file /tmp/pg-root.txt

  # MySQL connection that also applies the znapi-helpers routine bundle to a
  # persistent routines sub-account in the same pass:
  znvault dynasec connection provision my-mysql --type mysql \\
    --root-file /tmp/root.txt \\
    --routines-bundle znapi-helpers --routines-version 1

  # Custom account-name prefix for the generated admin/routines sub-accounts:
  znvault dynasec connection provision my-mysql --type mysql \\
    --root-file /tmp/root.txt --account-prefix zn_

  # Machine-readable output (CI pipelines, scripting):
  znvault dynasec connection provision my-mysql --type mysql \\
    --root-file /tmp/root.txt --json

Notes:
  - Pre-existing reserved accounts are never adopted or re-granted. Provision
    returns 409 adopted_account_no_password without mutating either account;
    use an unused --account-prefix or register a normal connection with a
    credential whose password you already control.
  - The root credential is used once, in-memory, for this call only — it is
    never stored, logged, or echoed back in the response or audit trail.
  - Root host is subject to the same SSRF host-allowlist guard as other
    dynamic-secrets connections (loopback/internal/metadata hosts are
    rejected with a 400).
  - On failure, the error message is printed along with the HTTP status;
    some failures (e.g. 422 root_insufficient, 502 provision_failed) occur
    partway through a multi-step process — re-run \`connection get <name>\`
    to inspect what (if anything) was left behind.
`)
    .action(provisionConnection);

  connection
    .command('rotate-admin <id>')
    .description(
      'Rotate the admin credential on an already-provisioned connection (generates a fresh ' +
      'password for the vault-managed admin sub-account; does not touch roles or leases)',
    )
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  # Rotate the admin credential for a connection by ID
  znvault dynasec connection rotate-admin 3f2b1c4a-...

  # Machine-readable confirmation
  znvault dynasec connection rotate-admin 3f2b1c4a-... --json

Notes:
  - This only rotates the vault-managed ADMIN account's password (the
    account provision created for managing roles and leases) — it
    does not affect the root credential (which vault never stores) or any
    already-issued dynamic-secret leases.
  - This cannot retrofit a pre-existing account rejected by \`connection
    provision\` with 409 adopted_account_no_password. It requires a working
    admin credential already stored on an active vault connection.
`)
    .action(rotateAdminCredential);

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
    .description('Create a new role for a connection (from a fixed template, or raw SQL as an escape hatch)')
    .option('--name <name>', 'Role name')
    .option('--description <desc>', 'Role description')
    .option('--template <name>', 'Create from a fixed, versioned server template (e.g. readonly, readwrite, ddl, migrate, packleader-client-v1-recovery) — mutually exclusive with the raw SQL flags below')
    .option('--template-version <n>', 'Template version (defaults to latest on the server if omitted)')
    .option('--creation-statements <sql>', '[raw mode, requires dynamic-secrets:roles:write-raw] SQL statements to create credentials (semicolon-separated)')
    .option('--revocation-statements <sql>', '[raw mode] SQL statements to revoke credentials (semicolon-separated)')
    .option('--renew-statements <sql>', '[raw mode] SQL statements to renew credentials (semicolon-separated)')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--username-template <template>', '[raw mode only] Username template (e.g., v_{{role}}_{{random:8}})')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  # Template mode (recommended): create a role from a shipped template.
  # Reuses the "dynamic-secrets:roles:write" permission you already have.
  znvault dynasec role create <connection-id> --name readwrite --template readwrite

  # Pin a specific template version instead of the server's latest
  znvault dynasec role create <connection-id> --name ro --template readonly --template-version 1

  # MySQL migrate role (grants EXECUTE on the pre-applied znapi-helpers
  # bundle; the bundle itself is applied automatically during
  # "dynasec connection provision" --routines-bundle/--routines-version).
  # Role creation still succeeds even if the bundle isn't applied yet — it
  # prints a "bundle_not_applied" warning.
  znvault dynasec role create <mysql-connection-id> --name migrator --template migrate

  # Recovery Fence v1: the server creates this role permanently disabled.
  # It can mint only through an OPEN fence plus a one-shot permit.
  znvault dynasec role create <mysql-connection-id> --name packleader-recovery \
    --template packleader-client-v1-recovery --template-version 1

  # Raw mode (escape hatch): hand-write the SQL yourself. Requires the
  # separate "dynamic-secrets:roles:write-raw" permission (NOT auto-granted —
  # ask an admin to grant it if you get a 403).
  znvault dynasec role create <connection-id> --name custom \\
    --creation-statements "CREATE ROLE \\"{{username}}\\" WITH LOGIN PASSWORD '{{password}}'" \\
    --revocation-statements "DROP ROLE IF EXISTS \\"{{username}}\\""

Template catalog (v1, fixed server-side — see "znvault dynasec templates list"):
  MySQL:      readonly, readwrite, ddl, migrate, packleader-client-v1-recovery
  PostgreSQL: readonly, readwrite     (ddl/migrate are MySQL-only; using them
                                        on a PostgreSQL connection 400s with
                                        ddl_unsupported_for_engine)

Notes:
  - Exactly one mode per role: --template XOR the raw SQL flags. Combining
    them is rejected client-side before any request is sent.
  - Template mode has a fixed schema — no --username-template, no custom
    schema. The server 400s (username_template_not_allowed /
    schema_override_unsupported) if you try; the CLI catches the
    --username-template case before sending the request.
  - Templates take no other caller params in v1. Inspect one with:
      znvault dynasec templates get <engine>/<name>/<version>
`)
    .action(createRole);

  role
    .command('update <role-id>')
    .description('Update a role')
    .requiredOption('--expected-config-revision <n>', 'Exact role CAS revision returned by role get')
    .option('--description <desc>', 'Role description')
    .option('--creation-statements <sql>', 'SQL statements to create credentials (semicolon-separated)')
    .option('--revocation-statements <sql>', 'SQL statements to revoke credentials (semicolon-separated)')
    .option('--renew-statements <sql>', 'SQL statements to renew credentials (semicolon-separated)')
    .option('--default-ttl <seconds>', 'Default credential TTL')
    .option('--max-ttl <seconds>', 'Maximum credential TTL')
    .option('--enabled <bool>', 'Enable or disable role (true/false)')
    .option('--json', 'Output as JSON')
    .action(updateRole);

  role
    .command('delete <role-id>')
    .alias('rm')
    .description('Delete a role (blocked while retained lease history exists)')
    .requiredOption('--expected-config-revision <n>', 'Exact role CAS revision returned by role get')
    .option('--force', 'Skip confirmation only; does not bypass lease-history retention')
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
    .option('--status <status>', 'Filter by status (ACTIVE, EXPIRED, REVOKED, FAILED, UNKNOWN)')
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

  // -------------------------------------------------------------------------
  // Templates Commands
  // -------------------------------------------------------------------------
  registerTemplatesCommands(dynasec);

  // -------------------------------------------------------------------------
  // Recovery Fence v1
  // -------------------------------------------------------------------------
  const fence = dynasec
    .command('recovery-fence')
    .description('Open, inspect, and close PostgreSQL-authoritative recovery fences');

  fence
    .command('open <role-id> <run-id>')
    .description('Open an idempotent recovery fence around a disabled MySQL role')
    .requiredOption('--consumer-api-key-id <id>', 'API key bound to all permits in this fence')
    .requiredOption('--expected-role-revision <n>', 'Pinned role configuration revision')
    .requiredOption('--expected-role-config-sha256 <hex>', 'Pinned lowercase role configuration SHA-256')
    .requiredOption('--expires-in-seconds <n>', 'Fence lifetime (PostgreSQL clock)')
    .requiredOption('--purpose <purpose>', 'Bounded operational purpose')
    .option('--json', 'Output as JSON')
    .action(openRecoveryFence);

  fence
    .command('status <role-id> <run-id>')
    .description('Get recovery fence state and drain counters')
    .option('--json', 'Output as JSON')
    .action(getRecoveryFenceStatus);

  fence
    .command('close <role-id> <run-id>')
    .description('Advance the fence epoch, drain operations, and verify final closure')
    .requiredOption('--expected-fence-epoch <n>', 'The OPEN epoch being closed')
    .option('--json', 'Output as JSON')
    .action(closeRecoveryFence);

  const permit = dynasec
    .command('permit')
    .description('Issue and inspect one-shot recovery mint permits');

  permit
    .command('issue <role-id>')
    .description('Issue an idempotent maxMints=1 permit (strict operator permission required)')
    .requiredOption('--fence-id <id>', 'Open recovery fence ID')
    .requiredOption('--consumer-api-key-id <id>', 'Consumer API key bound to the permit')
    .requiredOption('--phase <phase>', 'Recovery phase (issue one permit per phase)')
    .requiredOption('--expires-in-seconds <n>', 'Permit lifetime')
    .requiredOption('--credential-ttl-seconds <n>', 'Target credential lifetime')
    .option(
      '--privilege-overlay <overlay>',
      'NONE or MYSQL_SCHEMA_LOCK_TABLES (never arbitrary SQL)',
      'NONE',
    )
    .requiredOption('--reason <reason>', 'Auditable recovery reason')
    .requiredOption(
      '--idempotency-key <uuid>',
      'UUID persisted with the request; reuse it unchanged after an uncertain response',
    )
    .option('--json', 'Output as JSON')
    .action(issueMintPermit);

  permit
    .command('lookup <role-id>')
    .description('Read an existing permit by Idempotency-Key without issuing one')
    .requiredOption('--idempotency-key <uuid>', 'Previously approved issue UUID')
    .option('--json', 'Output as JSON')
    .action(lookupMintPermit);

  permit
    .command('status <permit-id> <request-id>')
    .description('Get an idempotent permit operation by request ID')
    .option('--json', 'Output as JSON')
    .action(getMintOperationStatus);

  permit
    .command('revoke <permit-id> <request-id>')
    .description('Revoke by request ID, including a pre-acquire tombstone')
    .option('--reason <reason>', 'Revocation reason')
    .option('--json', 'Output as JSON')
    .action(revokeMintOperation);
}
