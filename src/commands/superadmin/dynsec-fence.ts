// Path: src/commands/superadmin/dynsec-fence.ts

/**
 * `znvault superadmin dynsec fence` — deployment-wide CIDR/IP fence management.
 *
 * Routes (superadmin only, no tenant scoping):
 *   GET    /v1/superadmin/dynamic-secrets/fence
 *   POST   /v1/superadmin/dynamic-secrets/fence       { pattern, description?, force? }
 *   DELETE /v1/superadmin/dynamic-secrets/fence/:id
 */

import Table from 'cli-table3';
import type { Command } from 'commander';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface FenceRow {
  id: string;
  pattern: string;
  kind: 'cidr' | 'ip';
  description: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FenceListResponse {
  items: FenceRow[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatFenceDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function addFenceEntry(
  cidrOrIp: string,
  options: { description?: string; force?: boolean; json?: boolean },
): Promise<void> {
  const spinner = output.spinner('Adding fence entry...').start();

  try {
    const body: Record<string, unknown> = { pattern: cidrOrIp };
    if (options.description) body.description = options.description;
    if (options.force) body.force = true;

    const response = await client.post<FenceRow>('/v1/superadmin/dynamic-secrets/fence', body);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.success(`Fence entry "${response.pattern}" (${response.kind}) added (id: ${response.id})`);

    if (options.force) {
      output.warn(
        'Broad-fence alert: --force was used. A scanning alert has been emitted on the server.',
      );
    }
  } catch (err) {
    spinner.fail('Failed to add fence entry');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listFenceEntries(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching fence entries...').start();

  try {
    const response = await client.get<FenceListResponse>('/v1/superadmin/dynamic-secrets/fence');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    const items = response.items;
    if (items.length === 0) {
      output.info('No fence entries configured.');
      return;
    }

    const table = new Table({
      head: ['Pattern', 'Kind', 'Description', 'Created'],
      style: { head: ['cyan'] },
    });

    for (const row of items) {
      table.push([
        row.pattern,
        row.kind,
        row.description ?? '-',
        formatFenceDate(row.created_at),
      ]);
    }

    console.log(table.toString());
    output.info(`${items.length} fence entr${items.length === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    spinner.fail('Failed to list fence entries');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function removeFenceEntry(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const spinner = output.spinner('Removing fence entry...').start();

  try {
    await client.delete(`/v1/superadmin/dynamic-secrets/fence/${id}`);
    spinner.stop();

    output.success(`Fence entry ${id} removed`);

    if (options.json) {
      output.json({ removed: true, id });
    }
  } catch (err) {
    spinner.fail('Failed to remove fence entry');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerDynsecFenceCommands(parent: Command): void {
  const dynsec = parent.command('dynsec').description('Dynamic-secrets system administration');

  const fence = dynsec
    .command('fence')
    .description('Manage the deployment-wide CIDR/IP fence (superadmin only)');

  fence
    .command('add <cidr-or-ip>')
    .description('Add a CIDR or exact IP to the deployment-wide fence')
    .option('--description <desc>', 'Optional description')
    .option('--force', 'Allow broad fences (wider than /16 or all-RFC-1918); emits a scanning alert')
    .option('--json', 'Output as JSON')
    .action(addFenceEntry);

  fence
    .command('list')
    .alias('ls')
    .description('List fence entries')
    .option('--json', 'Output as JSON')
    .action(listFenceEntries);

  fence
    .command('rm <id>')
    .alias('remove')
    .description('Remove a fence entry by ID')
    .option('--json', 'Output as JSON')
    .action(removeFenceEntry);
}
