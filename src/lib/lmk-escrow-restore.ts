// Path: src/lib/lmk-escrow-restore.ts
//
// Restore a bootstrap key from a verified escrow bundle.
//
// This is the other half of `lmk escrow snapshot`. Without it the escrow copy
// could be written and checked but never used, and zn-vault's startup guard —
// which now refuses to boot when DATA_DIR/lmk.bin is missing and lmk_versions
// holds real versions — pointed at a recovery path that had no implementation.
//
// SCOPE: this writes the plaintext bootstrap key file, which is the correct
// target while the deployment stores the BSK that way. If a root-key provider
// is later introduced and the plaintext file is retired, this module needs a
// matching mode that re-wraps instead. Until then the plaintext file is the
// supported recovery target and this is the supported way to produce it.

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';

import {
  withVerifiedBootstrapKey,
  type LmkEscrowVerificationReport,
} from './lmk-escrow.js';

const BSK_BYTES = 32;
const FILE_MODE = 0o600;

export interface RestoreBootstrapKeyOptions {
  /** A complete escrow bundle. It is fully verified before anything is written. */
  bundle: Buffer;
  /** Where the bootstrap key file should end up, e.g. `${DATA_DIR}/lmk.bin`. */
  targetPath: string;
}

export interface RestoreBootstrapKeyReport {
  /**
   * `RESTORED` — the file did not exist and was written.
   * `ALREADY_PRESENT` — the file already held this exact key; nothing changed.
   */
  outcome: 'RESTORED' | 'ALREADY_PRESENT';
  targetPath: string;
  bundleId: string;
  copyLabel: string;
  activeLmkVersion: number;
  /** Publishable fingerprint. Safe for logs, receipts and drill records. */
  bskSha256: string;
}

/**
 * Restore the bootstrap key carried by `bundle` to `targetPath`.
 *
 * Refuses, without touching anything, when the target already holds a
 * *different* key. Replacing a live bootstrap key silently destroys every
 * secret it protects, and the loss stays invisible until the next unwrap —
 * so the only safe response is to stop and let a human look. Restoring a key
 * that is already in place is a no-op, so the drill is repeatable.
 *
 * The write is atomic and read back before success is reported. A write that
 * was not read back is not a restore.
 */
export function restoreBootstrapKeyFromBundle(
  options: RestoreBootstrapKeyOptions,
): RestoreBootstrapKeyReport {
  const { bundle, targetPath } = options;

  if (!isAbsolute(targetPath) && !targetPath.startsWith('.')) {
    // Relative paths are accepted (tests and DATA_DIR defaults use them) but a
    // bare filename with no directory part has no safe temp-file location.
    if (dirname(targetPath) === '.' && basename(targetPath) === targetPath) {
      throw new Error('Bootstrap key target must include a directory');
    }
  }

  const directory = dirname(targetPath);
  if (!existsSync(directory)) {
    throw new Error(`Bootstrap key target directory does not exist: ${directory}`);
  }

  // Verification first, always: a corrupted bundle must not create a file, not
  // even an empty one.
  return withVerifiedBootstrapKey(bundle, (bsk, report) => {
    if (bsk.length !== BSK_BYTES) {
      throw new Error('Verified bundle carries a bootstrap key of unexpected length');
    }

    if (existsSync(targetPath)) {
      const current = readFileSync(targetPath);
      const identical =
        current.length === bsk.length && timingSafeEqual(current, bsk);
      current.fill(0);
      if (identical) {
        return describe('ALREADY_PRESENT', targetPath, report);
      }
      throw new Error(
        `Refusing to restore: ${targetPath} already holds a different bootstrap key. ` +
          `Overwriting it would destroy every secret wrapped under the current key, ` +
          `and the loss would not surface until the next unwrap. Move the existing ` +
          `file aside deliberately, after establishing which key is correct, then ` +
          `run this again.`,
      );
    }

    writeAtomically(targetPath, bsk);

    const readBack = readFileSync(targetPath);
    const matches = readBack.length === bsk.length && timingSafeEqual(readBack, bsk);
    readBack.fill(0);
    if (!matches) {
      unlinkSync(targetPath);
      throw new Error(
        'Bootstrap key read-back did not match the bundle; the partial file was removed',
      );
    }

    return describe('RESTORED', targetPath, report);
  });
}

function describe(
  outcome: RestoreBootstrapKeyReport['outcome'],
  targetPath: string,
  report: LmkEscrowVerificationReport,
): RestoreBootstrapKeyReport {
  return {
    outcome,
    targetPath,
    bundleId: report.bundleId,
    copyLabel: report.copyLabel,
    activeLmkVersion: report.activeLmkVersion,
    bskSha256: report.bskSha256,
  };
}

/**
 * Write through a sibling temp file and rename, so an interrupted write can
 * never leave a truncated bootstrap key where a whole one is expected. A
 * truncated key is indistinguishable from a wrong one at rest and fails only
 * later, which is the worst way for this to fail.
 */
function writeAtomically(targetPath: string, contents: Buffer): void {
  const directory = dirname(targetPath);
  const temporary = join(directory, `.${basename(targetPath)}.restore-tmp`);

  if (existsSync(temporary)) unlinkSync(temporary);

  let handle: number | null = null;
  try {
    // wx: fail if it exists. Mode is set at creation, never widened later.
    handle = openSync(temporary, 'wx', FILE_MODE);
    writeSync(handle, contents, 0, contents.length, 0);
    fsyncSync(handle);
    closeSync(handle);
    handle = null;

    if (statSync(temporary).size !== contents.length) {
      throw new Error('Short write while restoring the bootstrap key');
    }

    renameSync(temporary, targetPath);
  } catch (error) {
    if (handle !== null) {
      try {
        closeSync(handle);
      } catch {
        // The original error is the one worth reporting.
      }
    }
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}
