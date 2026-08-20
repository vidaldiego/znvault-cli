// Path: src/commands/kmip/index.ts
// `znvault kmip` command registration.

import { type Command } from 'commander';
import { createClient, listClients, revokeClient, setSourceCidrs } from './clients.js';
import { listObjects, getStatus } from './objects.js';
import { enableKmip, reissueServerCert } from './admin.js';

export * from './types.js';

export function registerKmipCommands(program: Command): void {
  const kmip = program
    .command('kmip')
    .description('KMIP server (Synology encryption key vault) management')
    .addHelpText('after', `
Examples:
  # Check KMIP service status
  znvault kmip status

  # Create a client and write the DSM bundle (client.key/client.crt/ca.crt)
  znvault kmip client create nas-rack-1 --output-dir ./nas-rack-1

  # List and revoke clients
  znvault kmip client list
  znvault kmip client revoke CLIENT_ID

  # List managed objects (volume keys), metadata only
  znvault kmip object list

  # Superadmin: enable KMIP (one-time PKI init) / re-issue the server cert
  znvault superadmin kmip enable
  znvault superadmin kmip reissue-server-cert --yes
`);

  kmip.command('status').description('Show KMIP service status').option('--json', 'Output as JSON').action(getStatus);

  const clientCmd = kmip.command('client').description('Manage KMIP clients');
  clientCmd
    .command('create <name>')
    .description('Create a KMIP client and download its certificate bundle')
    .option('--description <text>', 'Optional description')
    .option('--output-dir <dir>', 'Directory to write client.key/client.crt/ca.crt (default: kmip-<name>)')
    .option(
      '--allowed-cidrs <cidrs>',
      'Comma-separated source-IP allowlist (e.g. "192.0.2.4/32"). Defense-in-depth on top of mTLS; empty = no restriction'
    )
    .option('--json', 'Output as JSON (includes the private key)')
    .action(createClient);
  clientCmd.command('list').description('List KMIP clients').option('--json', 'Output as JSON').action(listClients);
  clientCmd
    .command('set-cidrs <id> <cidrs>')
    .description('Set a client source-IP allowlist (comma-separated CIDRs; empty string clears it)')
    .option('--json', 'Output as JSON')
    .action(setSourceCidrs);
  clientCmd
    .command('revoke <id>')
    .description('Revoke a KMIP client')
    .option('--json', 'Output as JSON')
    .action(revokeClient);

  const objectCmd = kmip.command('object').description('Inspect KMIP managed objects (metadata only)');
  objectCmd.command('list').description('List KMIP objects').option('--json', 'Output as JSON').action(listObjects);

  return;
}

/** Superadmin-context KMIP commands (enable / reissue). Registered under `superadmin kmip`. */
export function registerKmipSuperadminCommands(parent: Command): void {
  const kmip = parent.command('kmip').description('KMIP server administration');
  kmip.command('enable').description('Initialize KMIP PKI and start the listener').option('--json', 'Output as JSON').action(enableKmip);
  kmip
    .command('reissue-server-cert')
    .description('Re-issue the KMIP server certificate (fleet-wide recovery event)')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(reissueServerCert);
}
