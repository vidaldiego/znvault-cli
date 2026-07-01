// Path: src/commands/dynamic-secrets/routines.ts

/**
 * `znvault dynasec routines` — apply/get a server-owned, hash-pinned
 * stored-routine bundle to a role's MySQL connection (Tasks A7/A8).
 *
 * Routes (tenant from JWT, no tenantId accepted here per the golden rule):
 *   POST /v1/dynamic-secrets/roles/:roleId/routines   { bundle, version }
 *   GET  /v1/dynamic-secrets/roles/:roleId/routines
 *
 * No SQL is ever sent from the CLI: `apply` only names a shipped bundle by
 * (name, version) — the routine source lives server-side in the bundle
 * registry. See docs/DYNAMIC_SECRETS_GUIDE.md for the bundle catalog.
 *
 * `bundles` (this command): there is currently no server endpoint to list
 * shipped bundles — A7/A8 only shipped apply/get. Rather than fabricate an
 * API call, this prints the one known-shipped bundle from a client-side
 * constant (kept in sync with src/services/dynamic-secrets/routine-bundles/
 * bundles.ts's REGISTRY on the server). If the registry grows or a list
 * endpoint is added, prefer wiring this to the server instead of hand-
 * maintaining the constant.
 */

import type { Command } from 'commander';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DbRole } from './types.js';
import { formatDate } from './helpers.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface RoutinesApplyResult {
  connectionId: string;
  bundle: string;
  version: number;
  appliedRoutines: number;
  applied: boolean;
}

interface RoutinesGetResult {
  configured: boolean;
  bundle: string | null;
  version: number | null;
  lastAppliedAt: string | null;
  lastAppliedHash: string | null;
}

interface ApplyOptions {
  bundle?: string;
  version?: string;
  role?: string;
  json?: boolean;
}

interface GetOptions {
  role?: string;
  json?: boolean;
}

/**
 * Known bundles shipped by the vault server. There is no server list
 * endpoint (yet) — see the module doc comment above. Keep this in sync with
 * src/services/dynamic-secrets/routine-bundles/bundles.ts's REGISTRY.
 */
const KNOWN_BUNDLES: Array<{ name: string; version: number; description: string }> = [
  { name: 'znapi-helpers', version: 1, description: 'ZincAPI migration helper routines (SQL SECURITY INVOKER, no DEFINER)' },
];

// ─── Identifier resolution ───────────────────────────────────────────────
//
// The routines endpoints are role-keyed. Callers may pass either a role ID
// or a connection ID as the positional argument:
//   - If it resolves as a role (GET /roles/:id succeeds), use it directly.
//   - Otherwise, treat it as a connection ID and list its roles:
//       - exactly one role → use it
//       - zero roles → error
//       - multiple roles → require --role to disambiguate (matched by
//         role id or role name)

async function resolveRoleId(
  connectionOrRole: string,
  roleOption: string | undefined,
): Promise<{ roleId: string } | { error: string }> {
  // Try as a role ID first.
  try {
    const role = await client.get<DbRole>(`/v1/dynamic-secrets/roles/${connectionOrRole}`);
    return { roleId: role.id };
  } catch {
    // Not a role (or inaccessible) — fall through to connection resolution.
  }

  // Try as a connection ID: list its roles.
  let roles: DbRole[];
  try {
    roles = await client.get<DbRole[]>(`/v1/dynamic-secrets/connections/${connectionOrRole}/roles`);
  } catch (err) {
    return {
      error: `"${connectionOrRole}" is not a known role or connection: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (roles.length === 0) {
    return { error: `Connection "${connectionOrRole}" has no roles. Create a role first, or pass a role ID directly.` };
  }

  if (roles.length === 1) {
    return { roleId: roles[0].id };
  }

  // Multiple roles — need --role to disambiguate.
  if (!roleOption) {
    const names = roles.map((r) => `${r.name} (${r.id})`).join(', ');
    return {
      error: `Connection "${connectionOrRole}" has multiple roles: ${names}. Pass --role <id-or-name> to disambiguate.`,
    };
  }

  const match = roles.find((r) => r.id === roleOption || r.name === roleOption);
  if (!match) {
    return { error: `--role "${roleOption}" does not match any role on connection "${connectionOrRole}".` };
  }
  return { roleId: match.id };
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function applyRoutines(
  connectionOrRole: string,
  options: ApplyOptions,
): Promise<void> {
  if (!options.bundle) {
    output.error('--bundle is required');
    process.exit(1);
  }
  if (!options.version) {
    output.error('--version is required');
    process.exit(1);
  }
  const version = parseInt(options.version, 10);
  if (!Number.isInteger(version) || version < 1) {
    output.error('--version must be a positive integer');
    process.exit(1);
  }

  const spinner = output.spinner('Resolving role...').start();

  const resolved = await resolveRoleId(connectionOrRole, options.role);
  if ('error' in resolved) {
    spinner.fail('Failed to resolve connection or role');
    output.error(resolved.error);
    process.exit(1);
  }

  spinner.text = 'Applying routine bundle...';

  try {
    const response = await client.post<RoutinesApplyResult>(
      `/v1/dynamic-secrets/roles/${resolved.roleId}/routines`,
      { bundle: options.bundle, version },
    );
    spinner.succeed('Routine bundle applied');

    if (options.json) {
      output.json(response);
      return;
    }

    output.success(
      `Applied bundle "${response.bundle}" v${response.version} to connection ${response.connectionId} ` +
      `(${response.appliedRoutines} routine(s))`,
    );
  } catch (err) {
    spinner.fail('Failed to apply routine bundle');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getRoutines(
  connectionOrRole: string,
  options: GetOptions,
): Promise<void> {
  const spinner = output.spinner('Resolving role...').start();

  const resolved = await resolveRoleId(connectionOrRole, options.role);
  if ('error' in resolved) {
    spinner.fail('Failed to resolve connection or role');
    output.error(resolved.error);
    process.exit(1);
  }

  spinner.text = 'Fetching routine-bundle state...';

  try {
    const response = await client.get<RoutinesGetResult>(
      `/v1/dynamic-secrets/roles/${resolved.roleId}/routines`,
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'Configured': response.configured ? 'yes' : 'no',
      'Bundle': response.bundle ?? '-',
      'Version': response.version ?? '-',
      'Last Applied': response.lastAppliedAt ? formatDate(response.lastAppliedAt) : '-',
      'Last Applied Hash': response.lastAppliedHash ?? '-',
    });
  } catch (err) {
    spinner.fail('Failed to get routine-bundle state');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function listBundles(options: { json?: boolean }): void {
  if (options.json) {
    output.json({ items: KNOWN_BUNDLES });
    return;
  }

  output.warn(
    'No server endpoint lists bundles yet — this is a client-side catalog of ' +
    'known-shipped bundles. It may drift from the server registry; verify with ' +
    '`znvault dynasec routines get` after applying.',
  );

  for (const b of KNOWN_BUNDLES) {
    output.info(`${b.name} v${b.version} — ${b.description}`);
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerRoutinesCommands(dynasec: Command): void {
  const routines = dynasec
    .command('routines')
    .description('Manage server-owned stored-routine bundles for a role\'s MySQL connection');

  routines
    .command('apply <connection-or-role>')
    .description('Apply a shipped routine bundle to a role (or a connection\'s single/disambiguated role)')
    .option('--bundle <name>', 'Bundle name (see `znvault dynasec routines bundles`)')
    .option('--version <n>', 'Bundle version')
    .option('--role <id-or-name>', 'Disambiguate which role to target when a connection has multiple roles')
    .option('--json', 'Output as JSON')
    .action(applyRoutines);

  routines
    .command('get <connection-or-role>')
    .description('Get the routine-bundle apply state for a role (or a connection\'s single/disambiguated role)')
    .option('--role <id-or-name>', 'Disambiguate which role to target when a connection has multiple roles')
    .option('--json', 'Output as JSON')
    .action(getRoutines);

  routines
    .command('bundles')
    .description('List known routine bundles (client-side catalog — no server list endpoint yet)')
    .option('--json', 'Output as JSON')
    .action(listBundles);
}
