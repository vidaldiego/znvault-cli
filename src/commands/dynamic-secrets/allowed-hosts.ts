// Path: src/commands/dynamic-secrets/allowed-hosts.ts

/**
 * `znvault dynasec allowed-hosts` — tenant-scoped host allowlist management.
 *
 * Routes (tenant from JWT, no tenantId accepted here per the golden rule):
 *   GET    /v1/dynamic-secrets/allowed-hosts
 *   POST   /v1/dynamic-secrets/allowed-hosts          { host, description? }
 *   DELETE /v1/dynamic-secrets/allowed-hosts/:id
 *   POST   /v1/dynamic-secrets/allowed-hosts/test     { host }
 */

import Table from 'cli-table3';
import type { Command } from 'commander';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { formatDate } from './helpers.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface TenantHostRow {
  id: string;
  tenant_id: string;
  host: string;
  description: string | null;
  enabled: boolean;
  grandfathered: boolean;
  verified: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AllowedHostsResponse {
  items: TenantHostRow[];
}

interface HostTestResult {
  allowed: boolean;
  reason?: string;
  tag?: string;
  vettedIp?: string;
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function addAllowedHost(
  host: string,
  options: { description?: string; json?: boolean },
): Promise<void> {
  const spinner = output.spinner('Adding allowed host...').start();

  try {
    const body: Record<string, unknown> = { host };
    if (options.description) body.description = options.description;

    const response = await client.post<TenantHostRow>('/v1/dynamic-secrets/allowed-hosts', body);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.success(`Allowed host "${response.host}" added (id: ${response.id})`);

    if (!response.verified) {
      output.warn(
        'Host stored UNVERIFIED (host did not resolve at registration time). ' +
        'Vault will attempt to verify it on the first successful connect.',
      );
    }
  } catch (err) {
    spinner.fail('Failed to add allowed host');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listAllowedHosts(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching allowed hosts...').start();

  try {
    const response = await client.get<AllowedHostsResponse>('/v1/dynamic-secrets/allowed-hosts');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    const items = response.items;
    if (items.length === 0) {
      output.info('No allowed-hosts configured for this tenant.');
      return;
    }

    const table = new Table({
      head: ['Host', 'Verified', 'Grandfathered', 'Description', 'Created'],
      style: { head: ['cyan'] },
    });

    for (const row of items) {
      table.push([
        row.host,
        row.verified ? 'yes' : 'NO',
        row.grandfathered ? 'yes' : '-',
        row.description ?? '-',
        formatDate(row.created_at),
      ]);
    }

    console.log(table.toString());
    output.info(`${items.length} allowed-host(s)`);
  } catch (err) {
    spinner.fail('Failed to list allowed hosts');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function removeAllowedHost(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const spinner = output.spinner('Removing allowed host...').start();

  try {
    await client.delete(`/v1/dynamic-secrets/allowed-hosts/${id}`);
    spinner.stop();

    if (options.json) {
      output.json({ removed: true, id });
      return;
    }

    output.success(`Allowed host ${id} removed`);
  } catch (err) {
    spinner.fail('Failed to remove allowed host');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function testAllowedHost(
  host: string,
  options: { json?: boolean },
): Promise<void> {
  const spinner = output.spinner('Testing host allowance...').start();

  try {
    const response = await client.post<HostTestResult>(
      '/v1/dynamic-secrets/allowed-hosts/test',
      { host },
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    const fields: Record<string, unknown> = {
      Allowed: response.allowed ? 'YES' : 'NO',
    };
    if (response.tag) fields.Tag = response.tag;
    if (response.vettedIp) fields['Vetted IP'] = response.vettedIp;
    if (response.reason) fields.Reason = response.reason;

    output.keyValue(fields);
  } catch (err) {
    spinner.fail('Failed to test host');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerAllowedHostsCommands(dynasec: Command): void {
  const ah = dynasec
    .command('allowed-hosts')
    .description('Manage the tenant connection-target allowlist');

  ah.command('add <host>')
    .description('Add a host to the allowed-hosts list')
    .option('--description <desc>', 'Optional description')
    .option('--json', 'Output as JSON')
    .action(addAllowedHost);

  ah.command('list')
    .alias('ls')
    .description('List allowed hosts')
    .option('--json', 'Output as JSON')
    .action(listAllowedHosts);

  ah.command('rm <id>')
    .alias('remove')
    .description('Remove an allowed host by ID')
    .option('--json', 'Output as JSON')
    .action(removeAllowedHost);

  ah.command('test <host>')
    .description('Test whether a host would be allowed (fence + tenant allowlist check)')
    .option('--json', 'Output as JSON')
    .action(testAllowedHost);
}
