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
import { getLocalVaultVersion } from '../lib/local.js';
import { getVersion } from '../lib/version.js';
import * as output from '../lib/output.js';

interface SnapshotOptions {
  mount: string;
  copyLabel: string;
  bskPath?: string;
  backupId?: string;
  allowUnboundLabSnapshot?: boolean;
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
    'BSK fingerprint': `sha256:${report.bskSha256}`,
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
      try {
        // getLocalConfig(), called by LocalDBClient, loads DATA_DIR/LMK_PATH from
        // the service environment before this path is resolved.
        const bskPath = resolveBskPath(options.bskPath);
        bsk = readBsk(bskPath);
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
          output.json(receipt);
          return;
        }
        output.section('LMK Escrow Snapshot Written and Read-Back Verified');
        printReport(receipt);
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
}
