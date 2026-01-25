// Path: src/commands/ssh-ca/index.ts

/**
 * SSH CA command registration
 */

import { type Command } from 'commander';
import { getStatus, initCA, deleteCA, getPublicKey } from './ca.js';
import { listMappings, createMapping, updateMapping, deleteMapping } from './mappings.js';
import {
  listServerGroups,
  getServerGroup,
  createServerGroup,
  deleteServerGroup,
  setAccessRule,
  deleteAccessRule,
  getAuthorizedPrincipals,
} from './server-groups.js';
import { listCertificates, getCertificate, revokeCertificate } from './certificates.js';
import { signCertificate } from './sign.js';

// Re-export types
export * from './types.js';

export function registerSSHCACommands(program: Command): void {
  const sshca = program
    .command('ssh-ca')
    .description('SSH Certificate Authority management')
    .addHelpText('after', `
Examples:
  # Initialize the CA
  znvault ssh-ca init --key-type ed25519 --default-ttl 28800

  # Get CA public key for server configuration
  znvault ssh-ca public-key --raw > /etc/ssh/trusted-user-ca-keys.pub

  # Create a principal mapping
  znvault ssh-ca mapping create --group-id GROUP_ID --principals deploy,developer

  # Create a server group and add access rules
  znvault ssh-ca server-group create --name production-web
  znvault ssh-ca server-group set-access GROUP_ID --linux-user deploy --principals deploy,admin

  # Sign your SSH public key
  znvault ssh-ca sign --file ~/.ssh/id_ed25519.pub > ~/.ssh/id_ed25519-cert.pub

  # List and revoke certificates
  znvault ssh-ca cert list --active-only
  znvault ssh-ca cert revoke CERT_ID --reason "User offboarded"
`);

  // -------------------------------------------------------------------------
  // CA Commands
  // -------------------------------------------------------------------------
  sshca
    .command('status')
    .description('Get SSH CA status')
    .option('--json', 'Output as JSON')
    .action(getStatus);

  sshca
    .command('init')
    .description('Initialize SSH CA')
    .option('--key-type <type>', 'Key type: ed25519 or rsa-4096')
    .option('--default-ttl <seconds>', 'Default certificate TTL in seconds')
    .option('--max-ttl <seconds>', 'Maximum certificate TTL in seconds')
    .option('--extensions <list>', 'Allowed extensions (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(initCA);

  sshca
    .command('delete')
    .description('Delete SSH CA (destructive!)')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteCA);

  sshca
    .command('public-key')
    .description('Get CA public key')
    .option('--raw', 'Output only the key (for piping to file)')
    .option('--json', 'Output as JSON')
    .action(getPublicKey);

  // -------------------------------------------------------------------------
  // Mapping Commands
  // -------------------------------------------------------------------------
  const mapping = sshca.command('mapping').description('Manage principal mappings (SSO group → SSH principals)');

  mapping
    .command('list')
    .alias('ls')
    .description('List principal mappings')
    .option('--json', 'Output as JSON')
    .action(listMappings);

  mapping
    .command('create')
    .description('Create a principal mapping')
    .option('--group-id <id>', 'SSO group ID')
    .option('--principals <list>', 'SSH principals (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(createMapping);

  mapping
    .command('update <mapping-id>')
    .description('Update a principal mapping')
    .option('--principals <list>', 'New SSH principals (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(updateMapping);

  mapping
    .command('delete <mapping-id>')
    .alias('rm')
    .description('Delete a principal mapping')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteMapping);

  // -------------------------------------------------------------------------
  // Server Group Commands
  // -------------------------------------------------------------------------
  const serverGroup = sshca.command('server-group').alias('sg').description('Manage server groups');

  serverGroup
    .command('list')
    .alias('ls')
    .description('List server groups')
    .option('--json', 'Output as JSON')
    .action(listServerGroups);

  serverGroup
    .command('get <group-id>')
    .description('Get server group details')
    .option('--json', 'Output as JSON')
    .action(getServerGroup);

  serverGroup
    .command('create')
    .description('Create a server group')
    .option('--name <name>', 'Server group name')
    .option('--description <desc>', 'Description')
    .option('--json', 'Output as JSON')
    .action(createServerGroup);

  serverGroup
    .command('delete <group-id>')
    .alias('rm')
    .description('Delete a server group')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteServerGroup);

  serverGroup
    .command('set-access <group-id>')
    .description('Set access rule for a server group')
    .option('--linux-user <user>', 'Linux user name')
    .option('--principals <list>', 'Allowed principals (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(setAccessRule);

  serverGroup
    .command('delete-access <group-id> <linux-user>')
    .description('Delete access rule from a server group')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteAccessRule);

  serverGroup
    .command('principals <group-id>')
    .description('Get authorized principals for server configuration')
    .option('--json', 'Output as JSON')
    .action(getAuthorizedPrincipals);

  // -------------------------------------------------------------------------
  // Certificate Commands
  // -------------------------------------------------------------------------
  const cert = sshca.command('cert').alias('certificate').description('Manage SSH certificates');

  cert
    .command('list')
    .alias('ls')
    .description('List certificates')
    .option('--active-only', 'Show only active certificates')
    .option('--revoked', 'Show only revoked certificates')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--limit <n>', 'Maximum number of results')
    .option('--json', 'Output as JSON')
    .action(listCertificates);

  cert
    .command('get <cert-id>')
    .description('Get certificate details')
    .option('--json', 'Output as JSON')
    .action(getCertificate);

  cert
    .command('revoke <cert-id>')
    .description('Revoke a certificate')
    .option('--reason <reason>', 'Revocation reason')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(revokeCertificate);

  // -------------------------------------------------------------------------
  // Sign Command
  // -------------------------------------------------------------------------
  sshca
    .command('sign')
    .description('Sign SSH public key to get a certificate')
    .option('--public-key <key>', 'SSH public key string')
    .option('--file <path>', 'Path to SSH public key file')
    .option('--ttl <seconds>', 'Certificate TTL in seconds')
    .option('--principals <list>', 'Direct principal specification (admin override, comma-separated). Requires ssh:ca:admin permission.')
    .option('--json', 'Output as JSON')
    .action(signCertificate);
}
