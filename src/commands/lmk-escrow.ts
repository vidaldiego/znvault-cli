// Path: src/commands/lmk-escrow.ts

import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import type { Command } from 'commander';
import { LocalDBClient, isLocalDbAvailable } from '../lib/db.js';
import {
  buildLmkEscrowBundle,
  makeLmkEscrowFilename,
  readAndVerifyLmkEscrowBundle,
  verifyLmkEscrowBundleBuffer,
  writeLmkEscrowBundleDirect,
  type LmkEscrowVerificationReport,
  type LmkEscrowWriteReceipt,
} from '../lib/lmk-escrow.js';
import { restoreBootstrapKeyFromBundle } from '../lib/lmk-escrow-restore.js';
import { resolveBskFromProvider } from '../lib/bsk-source.js';
import { createSentinelClient } from '../lib/sentinel-client.js';
import { getLocalVaultVersion } from '../lib/local.js';
import { getVersion } from '../lib/version.js';
import * as output from '../lib/output.js';

interface SnapshotOptions {
  mount: string;
  copyLabel: string;
  bskPath?: string;
  fromProvider?: string;
  sentinelUrl?: string;
  sentinelCa?: string;
  sentinelCert?: string;
  sentinelKey?: string;
  sentinelTimeoutMs?: string;
  backupId?: string;
  allowUnboundLabSnapshot?: boolean;
  json?: boolean;
}

/**
 * Obtain the bootstrap key for a snapshot, from a file or from the hardware
 * root, and say which in the receipt.
 *
 * The provider path exists so the ceremony does not have to run wherever the
 * cleartext key happens to live — in practice a production application node —
 * and so that retiring `lmk.bin` does not permanently end the ability to take
 * another escrow. See src/lib/bsk-source.ts.
 */
async function obtainBsk(
  options: SnapshotOptions,
  database: LocalDBClient,
): Promise<{ bsk: Buffer; source: string }> {
  if (options.fromProvider === undefined) {
    const bskPath = resolveBskPath(options.bskPath);
    return { bsk: readBsk(bskPath), source: `file:${bskPath}` };
  }

  if (options.bskPath !== undefined) {
    throw new Error('--from-provider and --bsk-path are mutually exclusive: pick one source.');
  }
  if (options.fromProvider !== 'sentinel') {
    // aws-kms is deliberately not offered. It would need AWS credentials on the
    // ceremony host, which is a materially different trust story from an mTLS
    // client certificate to an appliance sitting in the same room.
    throw new Error(
      `--from-provider currently supports only 'sentinel', not ` +
      `${JSON.stringify(options.fromProvider)}.`,
    );
  }

  const envelope = await database.getRootKeyEnvelope('sentinel');
  if (!envelope) {
    const available = await database.listRootKeyEnvelopeProviders();
    throw new Error(
      'No root-key envelope recorded for provider \'sentinel\'. Providers with an ' +
      `envelope: ${available.length > 0 ? available.join(', ') : '(none)'}.`,
    );
  }

  const client = createSentinelClient({
    url: requireOption(options.sentinelUrl, '--sentinel-url', 'ROOT_KEY_SENTINEL_URL'),
    caPath: requireOption(options.sentinelCa, '--sentinel-ca', 'ROOT_KEY_SENTINEL_CA'),
    certPath: requireOption(options.sentinelCert, '--sentinel-cert', 'ROOT_KEY_SENTINEL_CERT'),
    keyPath: requireOption(options.sentinelKey, '--sentinel-key', 'ROOT_KEY_SENTINEL_KEY'),
    timeoutMs: options.sentinelTimeoutMs === undefined
      ? undefined
      : Number(options.sentinelTimeoutMs),
  });

  const bsk = await resolveBskFromProvider(envelope, (ciphertext) => client.unwrap(ciphertext));
  return { bsk, source: `provider:sentinel (${envelope.kcv})` };
}

/** A ceremony fails loudly on a missing input, never on a silent default. */
function requireOption(value: string | undefined, flag: string, envVar: string): string {
  const resolved = value ?? process.env[envVar];
  if (resolved === undefined || resolved === '') {
    throw new Error(`${flag} is required with --from-provider (or set ${envVar}).`);
  }
  return resolved;
}

interface RestoreOptions {
  target: string;
  json?: boolean;
}

interface VerifyOptions {
  json?: boolean;
}

function resolveBskPath(explicitPath?: string): string {
  if (explicitPath !== undefined) return resolve(explicitPath);
  if (process.env.LMK_PATH !== undefined && process.env.LMK_PATH !== '') {
    return resolve(process.env.LMK_PATH);
  }
  return resolve(join(process.env.DATA_DIR ?? './data', 'lmk.bin'));
}

function readBsk(path: string): Buffer {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('BSK path must be a regular file, not a symlink');
  }
  if (realpathSync(path) !== path) {
    throw new Error('BSK path may not contain symlink components');
  }
  const bsk = readFileSync(path);
  if (bsk.length !== 32) {
    bsk.fill(0);
    throw new Error(`BSK must be exactly 32 bytes; ${path} contains ${String(bsk.length)}`);
  }
  return bsk;
}

function printReport(report: LmkEscrowVerificationReport | LmkEscrowWriteReceipt): void {
  output.keyValue({
    'Bundle ID': report.bundleId,
    'Copy label': report.copyLabel,
    'Active LMK': report.activeLmkVersion,
    'Recoverability': report.recoverability,
    'Recoverable versions': report.recoverableVersions.join(', '),
    'Historical gaps': report.unrecoverableVersions.length === 0
      ? 'none'
      : report.unrecoverableVersions.join(', '),
    'BSK fingerprint': report.bskKcv,
    'Backup binding': report.backupId ?? 'UNBOUND — LAB ONLY',
    'Active rotation': report.activeRotationId ?? 'none',
    ...('path' in report ? {
      'Device path': report.path,
      'Bytes': report.bytes,
      'Full-file SHA-256': report.fullFileSha256,
    } : {}),
  });
}

export function registerLmkEscrowCommands(lmk: Command): void {
  const escrow = lmk
    .command('escrow')
    .description('Local, direct-to-device BSK and versioned-LMK custody snapshots');

  escrow
    .command('snapshot')
    .description(
      'Capture the local BSK plus PostgreSQL-wrapped LMK generations and write ' +
      'once to a dedicated mounted device. No API export and no temporary file.',
    )
    .requiredOption('--mount <path>', 'Root of the mounted removable escrow device')
    .requiredOption('--copy-label <label>', 'Physical copy label, for example A or B')
    .option('--bsk-path <path>', 'Override LMK_PATH/DATA_DIR/lmk.bin')
    .option(
      '--from-provider <name>',
      "Source the BSK from a root-key provider instead of a file ('sentinel'). " +
      'Lets the ceremony run on a dedicated host, and keeps escrow possible ' +
      'after lmk.bin is retired.',
    )
    .option('--sentinel-url <url>', 'Sentinel base URL (https only)')
    .option('--sentinel-ca <path>', 'CA bundle that must issue the appliance certificate')
    .option('--sentinel-cert <path>', 'Client certificate presented to the appliance')
    .option('--sentinel-key <path>', 'Its private key')
    .option('--sentinel-timeout-ms <ms>', 'Request timeout (default 5000)')
    .option('--backup-id <id>', 'Bind the snapshot to a VERIFIED ZnVault backup record')
    .option(
      '--allow-unbound-lab-snapshot',
      'LAB ONLY: allow a snapshot with no verified backup binding',
    )
    .option('--json', 'Output only the redacted receipt as JSON')
    .action(async (options: SnapshotOptions) => {
      if (!isLocalDbAvailable()) {
        throw new Error(
          'LMK escrow snapshot is local-only. Run it on a Vault node with local ' +
          'database configuration; it will not export the BSK through the API.',
        );
      }
      if (options.backupId === undefined && options.allowUnboundLabSnapshot !== true) {
        throw new Error(
          'A VERIFIED --backup-id is required. Use --allow-unbound-lab-snapshot only in an isolated lab.',
        );
      }

      const spinner = output.spinner('Capturing LMK custody state...').start();
      const database = new LocalDBClient();
      let bsk: Buffer | null = null;
      let bundle: Buffer | null = null;
      let bskSource = '';
      try {
        // getLocalConfig(), called by LocalDBClient, loads DATA_DIR/LMK_PATH from
        // the service environment before this path is resolved.
        const obtained = await obtainBsk(options, database);
        bsk = obtained.bsk;
        bskSource = obtained.source;
        const snapshot = await database.captureLmkEscrow(options.backupId);
        bundle = buildLmkEscrowBundle({
          snapshot,
          bsk,
          copyLabel: options.copyLabel,
          operator: process.env.SUDO_USER ?? process.env.USER ?? `uid-${String(process.getuid?.() ?? 'unknown')}`,
          hostname: hostname(),
          vaultVersion: getLocalVaultVersion(),
          cliVersion: getVersion(),
          allowUnboundBackup: options.allowUnboundLabSnapshot === true,
        });
        const initialReport = verifyLmkEscrowBundleBuffer(bundle);
        const filename = makeLmkEscrowFilename(initialReport);
        const receipt = writeLmkEscrowBundleDirect(bundle, {
          mountPath: options.mount,
          filename,
        });
        spinner.stop();

        if (options.json === true) {
          // The source belongs in the machine-readable receipt too: an acta
          // that cannot distinguish a file-sourced ceremony from a
          // hardware-root one records the wrong control.
          output.json({ ...receipt, bskSource });
          return;
        }
        output.section('LMK Escrow Snapshot Written and Read-Back Verified');
        printReport(receipt);
        output.keyValue({ 'BSK source': bskSource });
        if (receipt.backupId === null) {
          output.warn('This snapshot is not bound to a verified database backup and is LAB-ONLY evidence.');
        }
        if (receipt.recoverability === 'KNOWN_HISTORICAL_GAPS') {
          output.warn(
            'The bundle preserves all material still available, but one or more historical LMK rows were already unrecoverable.',
          );
        }
        output.success('Set the datAshur to Admin-enforced read-only, eject it cleanly, then lock it.');
      } catch (error) {
        spinner.fail('LMK escrow snapshot failed');
        throw error;
      } finally {
        bsk?.fill(0);
        bundle?.fill(0);
        await database.close();
      }
    });

  escrow
    .command('verify <bundle>')
    .description('Read and cryptographically verify an LMK escrow bundle without printing key material')
    .option('--json', 'Output the redacted verification result as JSON')
    .action((bundlePath: string, options: VerifyOptions) => {
      const report = readAndVerifyLmkEscrowBundle(bundlePath);
      if (options.json === true) {
        output.json(report);
        return;
      }
      output.section('LMK Escrow Verification Passed');
      printReport(report);
      output.success(`Verified directly from ${dirname(resolve(bundlePath))}`);
    });

  escrow
    .command('restore <bundle>')
    .description('Restore the bootstrap key from a verified escrow bundle to --target')
    .requiredOption(
      '--target <path>',
      'Destination bootstrap key file, e.g. /var/lib/zn-vault/data/lmk.bin',
    )
    .option('--json', 'Output the redacted restore receipt as JSON')
    .action((bundlePath: string, options: RestoreOptions) => {
      const bundle = readFileSync(resolve(bundlePath));
      let receipt;
      try {
        receipt = restoreBootstrapKeyFromBundle({
          bundle,
          targetPath: resolve(options.target),
        });
      } finally {
        bundle.fill(0);
      }

      if (options.json === true) {
        output.json(receipt);
        return;
      }

      output.section(
        receipt.outcome === 'RESTORED'
          ? 'Bootstrap Key Restored'
          : 'Bootstrap Key Already Present',
      );
      output.keyValue({
        Target: receipt.targetPath,
        Copy: receipt.copyLabel,
        Bundle: receipt.bundleId,
        'Active LMK version': receipt.activeLmkVersion,
        'BSK fingerprint': receipt.bskKcv,
      });
      output.success(
        receipt.outcome === 'RESTORED'
          ? 'Written owner-only and read back. Record this receipt in the drill log.'
          : 'The target already held this exact key. Nothing was changed.',
      );
    });
}
