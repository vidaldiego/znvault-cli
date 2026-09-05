// Path: src/commands/lmk-escrow.ts

import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
  readAndVerifyLmkEscrowBundle,
  type LmkEscrowVerificationReport,
} from '../lib/lmk-escrow.js';
import { restoreBootstrapKeyFromBundle } from '../lib/lmk-escrow-restore.js';
import * as output from '../lib/output.js';


/** A ceremony fails loudly on a missing input, never on a silent default. */
interface RestoreOptions {
  target: string;
  json?: boolean;
}

interface VerifyOptions {
  json?: boolean;
}

function printReport(report: LmkEscrowVerificationReport): void {
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
  });
}

export function registerLmkEscrowCommands(lmk: Command): void {
  const escrow = lmk
    .command('escrow')
    .description(
      'Read an existing LMK escrow bundle. Producing one is no longer vault\'s ' +
      'job — see the note above registerLmkEscrowCommands.',
    );


  // ---------------------------------------------------------------------------
  // `escrow snapshot` and the whole `ceremony` command were REMOVED on
  // 2026-08-26. The escrow ceremony is not vault's: it belongs to
  // `zn-trust-root`, and vault contributes NO key material to it.
  //
  // Of the five items that ceremony escrows — legacy BSK, mini-CA, Sentinel
  // configuration, and the YubiHSM admin/daemon passwords — only one was ever
  // vault's. Vault obtains its BSK FROM trust, so a custody ceremony owned by
  // vault put the lower layer under the higher one, which is the DR deadlock
  // the whole programme exists to remove. What gets escrowed now is ONE root,
  // trust's, and vault's recoverability follows from it.
  //
  // WHAT SURVIVES, AND WHY. `verify` and `restore` stay. They only READ a
  // bundle, and removing the ability to read an artifact is the deletion that
  // cannot be undone operationally: if a bundle written by an earlier build
  // ever turns up, being unable to open it would be exactly the failure this
  // was built to prevent. They are legacy, not current practice.
  //
  // Handover, including everything learned the hard way about ceremony gates:
  // ~/Drive/docs/emergency-dr/TRASPASO-ceremonia-a-trust.md
  // ---------------------------------------------------------------------------


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
