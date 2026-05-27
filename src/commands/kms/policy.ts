// Path: src/commands/kms/policy.ts

/**
 * KMS per-key policy and grant commands.
 *
 * These manage the *per-key* authorization layer, which is independent of
 * the API-key RBAC permissions surfaced by `znvault api-key permissions`.
 * A caller must clear BOTH layers to use a KMS key:
 *
 *   1. RBAC (api_key.permissions, e.g. `kms:decrypt`) — gates whether the
 *      caller may invoke the KMS endpoint at all.
 *   2. Per-key policy / grant (kms_key_policies / kms_key_grants) — gates
 *      whether *this specific principal* may use *this specific key* for a
 *      given KMS action (`kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`,
 *      ...).
 *
 * When a key is created the creator (`createdBy`) is auto-granted
 * `kms:*` via a `default-owner` ALLOW policy. Any *other* principal that
 * needs to use the key requires an explicit `policy put` or `grant create`.
 *
 * Server endpoints used:
 *   PUT    /v1/kms/keys/:keyId/policy   (also under /v1/superadmin/...)
 *   GET    /v1/kms/keys/:keyId/policies (also under /v1/superadmin/...)
 *   GET    /v1/kms/keys/:keyId/grants   (also under /v1/superadmin/...)
 *   POST   /v1/kms/grants               (tenant-only)
 *   POST   /v1/kms/grants/:grantId/retire
 *   DELETE /v1/kms/grants/:grantId
 *
 * Note: there is no server endpoint to DELETE a policy entry by sid today;
 * the only way to remove one is to PUT a new policy with a non-matching
 * action/principal (or, in an emergency, edit kms_key_policies directly).
 * Tracked as a server-side gap.
 */

import type { Command } from 'commander';
import Table from 'cli-table3';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { kmsKeysPath, kmsKeysQuery, withKmsContext } from './routing.js';
import type {
  CreateGrantResponse,
  GrantCreateOptions,
  GrantListOptions,
  GrantRetireRevokeOptions,
  ListGrantsResponse,
  ListPoliciesResponse,
  PolicyListOptions,
  PolicyPutOptions,
} from './types.js';

// ============================================================================
// Policy commands
// ============================================================================

async function listPolicies(keyId: string, options: PolicyListOptions): Promise<void> {
  const spinner = output.spinner('Loading key policies...').start();

  try {
    const result = await client.get<ListPoliciesResponse>(
      kmsKeysPath(options.tenant, `/${keyId}/policies`) + kmsKeysQuery(options.tenant)
    );
    spinner.stop();

    if (options.json === true) {
      output.json(result);
      return;
    }

    if (result.policies.length === 0) {
      output.info(`No per-key policies on ${keyId}.`);
      output.info('Without a policy entry the creator is the only principal allowed (default-owner).');
      return;
    }

    const table = new Table({
      head: ['SID', 'Effect', 'Principal', 'Actions', 'Priority'],
      style: { head: ['cyan'] },
    });
    for (const p of result.policies) {
      table.push([
        p.sid,
        p.effect,
        p.principal,
        p.actions.join(', '),
        String(p.priority),
      ]);
    }
    console.log(table.toString());
  } catch (err) {
    spinner.fail('Failed to list policies');
    output.error((err as Error).message);
    process.exit(1);
  }
}

async function putPolicy(keyId: string, options: PolicyPutOptions): Promise<void> {
  const spinner = output.spinner(`Setting policy '${options.sid}' on ${keyId}...`).start();

  try {
    const priority = options.priority !== undefined ? parseInt(options.priority, 10) : 100;
    if (Number.isNaN(priority)) {
      throw new Error('--priority must be an integer');
    }

    // One or more comma-separated actions. The route accepts an actions[]
    // array and stores them joined; the evaluator splits on the way out
    // (server v1.41.16+), so multi-action policies work end-to-end.
    const actions = options.actions
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (actions.length === 0) {
      throw new Error('--actions must list at least one KMS action, e.g. kms:Decrypt');
    }

    const body = {
      sid: options.sid,
      effect: options.effect ?? 'ALLOW',
      principal: options.principal,
      actions,
      priority,
    };

    await client.put<{ success: boolean }>(
      kmsKeysPath(options.tenant, `/${keyId}/policy`) + kmsKeysQuery(options.tenant),
      body
    );
    spinner.stop();

    if (options.json === true) {
      output.json({ success: true, sid: options.sid });
      return;
    }

    output.success(`Policy '${options.sid}' applied to key ${keyId}.`);
    console.log(`  Effect:    ${body.effect}`);
    console.log(`  Principal: ${options.principal}`);
    console.log(`  Actions:   ${actions.join(', ')}`);
    console.log(`  Priority:  ${String(priority)}`);
  } catch (err) {
    spinner.fail('Failed to set policy');
    output.error((err as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Grant commands
// ============================================================================

async function listGrants(keyId: string, options: GrantListOptions): Promise<void> {
  const spinner = output.spinner('Loading key grants...').start();

  try {
    const result = await client.get<ListGrantsResponse>(
      kmsKeysPath(options.tenant, `/${keyId}/grants`) + kmsKeysQuery(options.tenant)
    );
    spinner.stop();

    if (options.json === true) {
      output.json(result);
      return;
    }

    if (result.grants.length === 0) {
      output.info(`No grants on ${keyId}.`);
      return;
    }

    const table = new Table({
      head: ['Grant ID', 'Grantee', 'Operations', 'Expires', 'Created'],
      style: { head: ['cyan'] },
    });
    for (const g of result.grants) {
      table.push([
        g.grantId,
        g.granteePrincipal,
        g.operations.join(', '),
        g.expiresAt ?? '—',
        g.createdAt,
      ]);
    }
    console.log(table.toString());
  } catch (err) {
    spinner.fail('Failed to list grants');
    output.error((err as Error).message);
    process.exit(1);
  }
}

async function createGrant(keyId: string, options: GrantCreateOptions): Promise<void> {
  const spinner = output.spinner('Creating grant...').start();

  try {
    const operations = options.operations
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (operations.length === 0) {
      throw new Error('--operations must list at least one action, e.g. kms:Decrypt');
    }

    const body: Record<string, unknown> = {
      keyId,
      granteePrincipal: options.grantee,
      operations,
    };
    if (options.name !== undefined) body.name = options.name;
    if (options.retiringPrincipal !== undefined) body.retiringPrincipal = options.retiringPrincipal;
    if (options.expiresAt !== undefined) body.expiresAt = options.expiresAt;

    // Grants live under /v1/kms/grants (tenant-only — no superadmin route).
    const result = await client.post<CreateGrantResponse>('/v1/kms/grants', body);
    spinner.stop();

    if (options.json === true) {
      output.json(result);
      return;
    }

    output.success('Grant created.');
    console.log(`  Grant ID:    ${result.grantId}`);
    console.log(`  Grantee:     ${options.grantee}`);
    console.log(`  Operations:  ${operations.join(', ')}`);
    if (options.expiresAt !== undefined) console.log(`  Expires:     ${options.expiresAt}`);
    console.log(`  Grant token: ${result.grantToken}`);
  } catch (err) {
    spinner.fail('Failed to create grant');
    output.error((err as Error).message);
    process.exit(1);
  }
}

async function retireGrant(grantId: string, options: GrantRetireRevokeOptions): Promise<void> {
  const spinner = output.spinner(`Retiring grant ${grantId}...`).start();
  try {
    await client.post<{ success: boolean }>(`/v1/kms/grants/${grantId}/retire`, {});
    spinner.stop();
    if (options.json === true) { output.json({ success: true, grantId }); return; }
    output.success(`Grant ${grantId} retired.`);
  } catch (err) {
    spinner.fail('Failed to retire grant');
    output.error((err as Error).message);
    process.exit(1);
  }
}

async function revokeGrant(grantId: string, options: GrantRetireRevokeOptions): Promise<void> {
  const spinner = output.spinner(`Revoking grant ${grantId}...`).start();
  try {
    await client.delete<{ success: boolean }>(`/v1/kms/grants/${grantId}`);
    spinner.stop();
    if (options.json === true) { output.json({ success: true, grantId }); return; }
    output.success(`Grant ${grantId} revoked.`);
  } catch (err) {
    spinner.fail('Failed to revoke grant');
    output.error((err as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerPolicyCommands(parent: Command, asSuperadmin = false): void {
  // ---- policy <list|put> ----
  const policy = parent
    .command('policy')
    .description('Manage per-key policies (independent of API-key RBAC permissions)');

  policy
    .command('list <keyId>')
    .description('List per-key policies on a KMS key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: PolicyListOptions) =>
      withKmsContext(asSuperadmin, () => listPolicies(keyId, options))
    );

  policy
    .command('put <keyId>')
    .description('Add or update a per-key policy entry (idempotent by sid)')
    .requiredOption('--sid <sid>', 'Statement identifier (unique per key; used as upsert key)')
    .requiredOption('--principal <principal>', 'Principal string, e.g. apikey:key_<hex>, user:<id>, or *')
    .requiredOption(
      '--actions <actions>',
      'KMS action(s), comma-separated. Single: "kms:Decrypt". Multiple: "kms:Encrypt,kms:Decrypt". Wildcard: "kms:*". Case-sensitive.'
    )
    .option('--effect <ALLOW|DENY>', 'ALLOW or DENY (default ALLOW; explicit DENY always wins)', 'ALLOW')
    .option('--priority <n>', 'Priority integer (default 100; lower evaluated first, but DENY wins regardless)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: PolicyPutOptions) =>
      withKmsContext(asSuperadmin, () => putPolicy(keyId, options))
    );

  // ---- grant <list|create|retire|revoke> ----
  const grant = parent
    .command('grant')
    .description('Manage per-key grants (revocable per-principal permissions)');

  grant
    .command('list <keyId>')
    .description('List active grants on a KMS key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: GrantListOptions) =>
      withKmsContext(asSuperadmin, () => listGrants(keyId, options))
    );

  grant
    .command('create <keyId>')
    .description('Create a grant allowing a principal to perform operations on a key')
    .requiredOption('--grantee <principal>', 'Principal to grant, e.g. apikey:key_<hex>')
    .requiredOption('--operations <ops>', 'Comma-separated actions, e.g. kms:Decrypt,kms:Encrypt')
    .option('--name <name>', 'Human-readable grant name')
    .option('--retiring-principal <p>', 'Principal allowed to retire this grant')
    .option('--expires-at <iso>', 'ISO-8601 expiration timestamp')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: GrantCreateOptions) => createGrant(keyId, options));

  grant
    .command('retire <grantId>')
    .description('Retire a grant (intentional, by grantee or retiring principal)')
    .option('--json', 'Output as JSON')
    .action((grantId: string, options: GrantRetireRevokeOptions) => retireGrant(grantId, options));

  grant
    .command('revoke <grantId>')
    .description('Revoke a grant (administrative removal)')
    .option('--json', 'Output as JSON')
    .action((grantId: string, options: GrantRetireRevokeOptions) => revokeGrant(grantId, options));
}
