// Path: znvault-cli/src/commands/lmk-restore-drill.ts
//
// `znvault superadmin lmk restore-drill {pre,post}` — the two gates of an
// isolated restore, wired to a real database and a real health endpoint.
//
// The drill it gates answers one question: can this escrow bundle bring back
// THIS deployment's keys? Everything here exists because the obvious way to
// answer it — start a vault and see if it comes up — answers a different
// question and answers it wrong. A vault started against an empty database
// takes the first-boot path, mints a new LMK, and reports a completely healthy
// start. See src/lib/restore-drill.ts for the full note.
//
// Two phases, because the interesting failure is only visible before the vault
// runs. Once it mints a replacement key the table holds an ordinary version 1
// with material and nothing distinguishes it from a successful restore.
//
//   pre   after restoring the dump, BEFORE starting the vault
//   post  after the vault is up
//
// Both refuse to run against anything that is not loopback: pointed at a live
// deployment they would compare that deployment against the bundle and record
// a successful restore in which nothing was restored.

import { request as httpsRequest } from 'node:https';
import { type Command } from 'commander';
import pg from 'pg';

import * as output from '../lib/output.js';
import { readAndVerifyLmkEscrowBundle } from '../lib/lmk-escrow.js';
import {
  assertBootedOnRestoredKeys,
  assertIsolatedTarget,
  assertRestoredDatabaseIsRecoverable,
  type HealthBody,
  type RestoredLmkVersion,
} from '../lib/restore-drill.js';

interface DrillOptions {
  databaseUrl: string;
  escrowBundle: string;
  healthUrl?: string;
  json?: boolean;
}

interface VersionRow {
  version: number;
  status: string;
  wrapped: string | number | null;
}

async function readVersions(databaseUrl: string): Promise<RestoredLmkVersion[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<VersionRow>(
      `SELECT version, status::text AS status, octet_length(wrapped_lmk) AS wrapped
         FROM lmk_versions ORDER BY version`,
    );
    return result.rows.map((row) => ({
      version: row.version,
      status: row.status,
      hasWrappedLmk: row.wrapped !== null && Number(row.wrapped) > 0,
    }));
  } finally {
    await client.end();
  }
}

/**
 * Fetch `/v1/health` from the bench node.
 *
 * TLS verification is off, and that is correct here rather than lazy: the bench
 * node runs a self-signed certificate on loopback, and what the drill actually
 * authenticates is the KCV in the body against the escrow bundle. Trusting the
 * certificate would prove the node has a certificate.
 */
async function readHealth(healthUrl: string): Promise<HealthBody> {
  return await new Promise<HealthBody>((resolve, reject) => {
    const req = httpsRequest(healthUrl, { rejectUnauthorized: false, timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as HealthBody);
        } catch (error) {
          reject(new Error(`Health endpoint did not return JSON: ${String(error)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Health endpoint timed out after 10s'));
    });
    req.on('error', reject);
    req.end();
  });
}

function reportVersions(versions: RestoredLmkVersion[]): void {
  output.table(
    ['Version', 'Status', 'Wrapped material'],
    versions.map((v) => [
      String(v.version),
      v.status,
      v.hasWrappedLmk ? 'yes' : 'no',
    ]),
  );
}

export function registerLmkRestoreDrillCommands(lmk: Command): void {
  const drill = lmk
    .command('restore-drill')
    .description(
      'Gates for an isolated restore drill. Run "pre" after restoring the dump ' +
      'and BEFORE starting the vault, then "post" once it is up.',
    );

  drill
    .command('pre')
    .description(
      'Assert the restored database actually carries recoverable key material. ' +
      'Starting a vault against an empty one mints a new LMK and reports success.',
    )
    .requiredOption('--database-url <url>', 'Restored database (loopback only)')
    .requiredOption('--escrow-bundle <path>', 'The escrow bundle being drilled')
    .option('--json', 'Output the observed inventory as JSON')
    .action(async (options: DrillOptions) => {
      assertIsolatedTarget(options.databaseUrl, 'database');

      // Verifying the bundle also authenticates the BSK inside it against every
      // recoverable LMK generation it carries, so a bundle that cannot open its
      // own contents fails here rather than halfway through the drill.
      const bundle = readAndVerifyLmkEscrowBundle(options.escrowBundle);
      const versions = await readVersions(options.databaseUrl);

      if (options.json === true) {
        output.json({ phase: 'pre', bundle, versions });
      } else {
        output.section('Restore drill — before starting the vault');
        output.keyValue({
          Bundle: bundle.bundleId,
          'Copy label': bundle.copyLabel,
          'BSK fingerprint': bundle.bskKcv,
          'Expected ACTIVE LMK': bundle.activeLmkVersion,
        });
        reportVersions(versions);
      }

      assertRestoredDatabaseIsRecoverable(versions, bundle.activeLmkVersion);

      if (options.json !== true) {
        output.success(
          'The restored database carries the key material the bundle describes. ' +
          'Start the vault, then run the "post" phase.',
        );
      }
    });

  drill
    .command('post')
    .description(
      'Assert the running vault came up on the ESCROWED key and the ESCROWED ' +
      'LMK version — never on an exit code or an HTTP status.',
    )
    .requiredOption('--database-url <url>', 'Restored database (loopback only)')
    .requiredOption('--escrow-bundle <path>', 'The escrow bundle being drilled')
    .requiredOption('--health-url <url>', 'The bench node /v1/health (loopback only)')
    .option('--json', 'Output the observed state as JSON')
    .action(async (options: DrillOptions) => {
      assertIsolatedTarget(options.databaseUrl, 'database');
      if (options.healthUrl === undefined) throw new Error('--health-url is required');
      assertIsolatedTarget(options.healthUrl, 'health endpoint');

      const bundle = readAndVerifyLmkEscrowBundle(options.escrowBundle);
      const health = await readHealth(options.healthUrl);
      const versions = await readVersions(options.databaseUrl);

      if (options.json === true) {
        output.json({ phase: 'post', bundle, health, versions });
      } else {
        output.section('Restore drill — after the vault started');
        output.keyValue({
          'Bundle BSK fingerprint': bundle.bskKcv,
          'Node root-key fingerprint': health.rootKey?.kcv ?? '(no rootKey block)',
          'Node provider': health.rootKey?.provider ?? '(none)',
          Degraded: health.rootKey?.degraded === true ? 'YES' : 'no',
          'Expected ACTIVE LMK': bundle.activeLmkVersion,
        });
        reportVersions(versions);
      }

      assertBootedOnRestoredKeys({
        health,
        versionsAfterBoot: versions,
        expectedBskKcv: bundle.bskKcv,
        expectedActiveVersion: bundle.activeLmkVersion,
      });

      if (options.json !== true) {
        output.success(
          'The vault booted on the escrowed bootstrap key and on the escrowed LMK ' +
          'version. Nothing was minted. This bundle restores this deployment.',
        );
      }
    });
}
