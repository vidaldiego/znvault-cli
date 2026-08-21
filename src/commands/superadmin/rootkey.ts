// Path: src/commands/superadmin/rootkey.ts

/**
 * `znvault superadmin rootkey` — root-of-trust provider chain for the
 * vault's bootstrap key (BSK).
 *
 * Routes (superadmin only, deployment-wide, no tenant scoping):
 *   GET  /v1/superadmin/rootkey/status
 *   POST /v1/superadmin/rootkey/verify
 *   POST /v1/superadmin/rootkey/wrap      { provider }
 *
 * Contract: no command prints key material — the server never returns
 * any; the publishable KCV fingerprint is the only key identity shown.
 * No command can remove an envelope or the cleartext key file
 * (retirement is a separate, deliberate server-side procedure that has
 * no API in this release). `verify` exits 1 when any configured provider
 * fails or mismatches, so it can gate migrations and drive monitoring.
 */

import Table from 'cli-table3';
import type { Command } from 'commander';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';

// ─── Types (wire shapes of the /v1/superadmin/rootkey/* routes) ────────────

interface RootKeyAttempt {
  providerId: string;
  type: string;
  outcome: 'served' | 'no_material' | 'error' | 'not_tried';
  latencyMs?: number;
  error?: string;
}

interface RootKeyProbeResult {
  providerId: string;
  outcome: 'match' | 'mismatch' | 'no_material' | 'error';
  kcv?: string;
  latencyMs: number;
  error?: string;
}

interface RootKeyProbeState {
  at: string;
  degraded: boolean;
  results: RootKeyProbeResult[];
}

interface RootKeyResolutionState {
  resolvedAt: string;
  servedBy: string | null;
  kcv: string | null;
  degraded: boolean;
  totalLatencyMs: number;
  attempts: RootKeyAttempt[];
  configured: Array<{ id: string; type: string; priority: number }>;
  /** Latest periodic post-boot provider probe, when the service has run one. */
  lastProbe?: RootKeyProbeState;
}

interface RootKeyEnvelopeMetadata {
  provider_id: string;
  provider_type: string;
  key_id: string | null;
  kcv: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface RootKeyStatusResponse {
  resolution: RootKeyResolutionState | null;
  envelopes: RootKeyEnvelopeMetadata[];
  localFile: { path: string; present: boolean };
}

interface RootKeyVerifyResult {
  providerId: string;
  outcome: 'match' | 'mismatch' | 'no_material' | 'error';
  kcv?: string;
  latencyMs: number;
  error?: string;
}

interface RootKeyVerifyResponse {
  activeKcv: string;
  /** STRICT: true only when every configured provider reports 'match'. */
  allMatch: boolean;
  results: RootKeyVerifyResult[];
}

interface RootKeyWrapReceipt {
  providerId: string;
  keyId: string | null;
  kcv: string;
  createdAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function rootkeyStatus(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching root key provider status...').start();

  try {
    const response = await client.get<RootKeyStatusResponse>(
      '/v1/superadmin/rootkey/status',
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    const resolution = response.resolution;
    // Effective degraded = boot resolution OR the latest periodic probe;
    // status must never report last-boot nostalgia as current health.
    const effectiveDegraded =
      resolution !== null &&
      (resolution.degraded || resolution.lastProbe?.degraded === true);
    output.section('Root Key Provider Status');
    output.keyValue({
      'Degraded': resolution ? (effectiveDegraded ? 'YES — investigate' : 'no') : 'unknown (no resolution)',
      'Served by (last boot)': resolution?.servedBy ?? '-',
      'Active KCV': resolution?.kcv ?? '-',
      'Resolved at': formatDate(resolution?.resolvedAt),
      'Total latency': resolution ? `${String(resolution.totalLatencyMs)}ms` : '-',
      'Last probe': resolution?.lastProbe
        ? `${formatDate(resolution.lastProbe.at)} — ${resolution.lastProbe.degraded ? 'DEGRADED' : 'healthy'}`
        : 'never (probe has not run yet)',
      'Cleartext file on this node': response.localFile.present ? 'present' : 'absent',
    });

    if (effectiveDegraded) {
      output.warn(
        'The chain is DEGRADED: a configured provider failed or had no material ' +
          'at the last resolution or probe. The node is up, but redundancy is reduced.',
      );
    }

    if (resolution) {
      const table = new Table({
        head: ['Priority', 'Provider', 'Outcome', 'Latency'],
        style: { head: ['cyan'] },
      });
      for (const attempt of resolution.attempts) {
        const priority =
          resolution.configured.find((c) => c.id === attempt.providerId)?.priority ?? '-';
        table.push([
          String(priority),
          attempt.providerId,
          attempt.outcome + (attempt.error ? ` (${attempt.error})` : ''),
          attempt.latencyMs === undefined ? '-' : `${String(attempt.latencyMs)}ms`,
        ]);
      }
      console.log(table.toString());
    }

    if (resolution?.lastProbe) {
      const probeTable = new Table({
        head: ['Probe: Provider', 'Outcome', 'KCV', 'Latency'],
        style: { head: ['cyan'] },
      });
      for (const result of resolution.lastProbe.results) {
        probeTable.push([
          result.providerId,
          result.outcome + (result.error ? ` (${result.error})` : ''),
          result.kcv ?? '-',
          `${String(result.latencyMs)}ms`,
        ]);
      }
      console.log(probeTable.toString());
    }

    if (response.envelopes.length > 0) {
      const table = new Table({
        head: ['Envelope', 'Key ID', 'KCV', 'Updated'],
        style: { head: ['cyan'] },
      });
      for (const envelope of response.envelopes) {
        table.push([
          envelope.provider_id,
          envelope.key_id ?? '-',
          envelope.kcv,
          formatDate(envelope.updated_at),
        ]);
      }
      console.log(table.toString());
    } else {
      output.info('No provider envelopes exist yet (create one with: rootkey wrap --provider <id>).');
    }
  } catch (err) {
    spinner.fail('Failed to fetch root key status');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function rootkeyVerify(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Verifying every configured root key provider...').start();

  try {
    const response = await client.post<RootKeyVerifyResponse>(
      '/v1/superadmin/rootkey/verify',
      {},
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
    } else {
      const table = new Table({
        head: ['Provider', 'Outcome', 'KCV', 'Latency'],
        style: { head: ['cyan'] },
      });
      for (const result of response.results) {
        table.push([
          result.providerId,
          result.outcome + (result.error ? ` (${result.error})` : ''),
          result.kcv ?? '-',
          `${String(result.latencyMs)}ms`,
        ]);
      }
      console.log(table.toString());
    }

    if (response.allMatch) {
      if (!options.json) {
        output.success(
          `All configured providers agree with the active key (KCV ${response.activeKcv}).`,
        );
      }
      return;
    }

    // STRICT gate: anything other than 'match' fails — including a
    // provider with no material. A green result on an unprovisioned
    // provider would let an operator reorder priorities onto nothing.
    const failing = response.results
      .filter((r) => r.outcome !== 'match')
      .map((r) => r.providerId);
    output.error(
      `Root key verification FAILED for: ${failing.join(', ')}. ` +
        'Do not change provider priorities or retire anything until every ' +
        'configured provider verifies.',
    );
    process.exit(1);
  } catch (err) {
    spinner.fail('Root key verification failed');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Mirror of the server's schema constraint. Enforced BEFORE any output or
 * request: an operator who accidentally pastes a secret as --provider must
 * see nothing echo it — not the spinner, not an error, not CI logs.
 */
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export async function rootkeyWrap(options: {
  provider: string;
  json?: boolean;
}): Promise<void> {
  if (!PROVIDER_ID_PATTERN.test(options.provider)) {
    output.error(
      'Invalid provider id: expected 1-32 lowercase letters, digits or hyphens ' +
        "(e.g. 'aws-kms'). The value you passed is not echoed on purpose.",
    );
    process.exit(1);
  }

  const spinner = output.spinner(
    `Wrapping the bootstrap key into '${options.provider}'...`,
  ).start();

  try {
    const receipt = await client.post<RootKeyWrapReceipt>(
      '/v1/superadmin/rootkey/wrap',
      { provider: options.provider },
    );
    spinner.stop();

    if (options.json) {
      output.json(receipt);
      return;
    }

    output.section('Root Key Envelope Written');
    output.keyValue({
      'Provider': receipt.providerId,
      'Key ID': receipt.keyId ?? '-',
      'KCV': receipt.kcv,
      'Created': formatDate(receipt.createdAt),
    });
    output.success(
      `Envelope for '${receipt.providerId}' persisted (replicates to every node via the database).`,
    );
    output.info(
      "Next: run 'znvault superadmin rootkey verify' to prove every provider opens the same key.",
    );
  } catch (err) {
    spinner.fail('Failed to wrap the bootstrap key');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerRootkeyCommands(parent: Command): void {
  const rootkey = parent
    .command('rootkey')
    .description('Root-of-trust provider chain for the bootstrap key (superadmin only)');

  rootkey
    .command('status')
    .description('Show configured providers, last-boot resolution, degraded flag and KCV')
    .option('--json', 'Output as JSON')
    .action(rootkeyStatus);

  rootkey
    .command('verify')
    .description('Probe every configured provider and compare KCVs; exits 1 on any failure')
    .option('--json', 'Output as JSON')
    .action(rootkeyVerify);

  rootkey
    .command('wrap')
    .description("Wrap the current bootstrap key into a provider's envelope (never retires anything)")
    .requiredOption('--provider <id>', "Configured envelope provider id (e.g. 'aws-kms')")
    .option('--json', 'Output the receipt as JSON')
    .action(rootkeyWrap);
}
