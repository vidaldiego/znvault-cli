// Path: test/lib/lmk-escrow-restore.test.ts
//
// The escrow bundle could be written and verified, but never restored.
//
// WHY THIS MATTERS: zn-vault now fails closed at startup when DATA_DIR/lmk.bin
// is absent and lmk_versions holds real versions. Its error tells the operator
// to restore the file from backup. Until this exists, that instruction has no
// implementation — the only supported recovery path is unimplemented, and the
// restore drill that ISO/IEC 27001:2022 8.13 requires ("backup copies ... shall
// be maintained and regularly tested") cannot be executed at all.
//
// THE SAFETY CONTRACT, which is most of the point:
//   - Never overwrite a bootstrap key that differs from the bundle's. A node
//     whose live key is silently replaced loses every secret it protects, and
//     the loss is invisible until the next unwrap.
//   - Restoring the key that is already there is a no-op, not an error. The
//     drill must be repeatable.
//   - Verify by reading back what was written. A write that was not read back
//     is not a restore.
//   - Never leave a partial file. A truncated bootstrap key is indistinguishable
//     from a wrong one at rest, and fails only later.
//   - Never return, log or embed key material in a report or an error.

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { LmkEscrowDatabaseSnapshot } from '../../src/lib/db/lmk-escrow.js';
import { buildLmkEscrowBundle } from '../../src/lib/lmk-escrow.js';
import { restoreBootstrapKeyFromBundle } from '../../src/lib/lmk-escrow-restore.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'znvault-restore-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function wrapLmk(bsk: Buffer, material: Buffer, version: number): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bsk, nonce);
  cipher.setAAD(Buffer.from(`lmk_version=${String(version)}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
  return Buffer.concat([Buffer.from([0x01]), nonce, ciphertext, cipher.getAuthTag()]);
}

function makeSnapshot(bsk: Buffer): LmkEscrowDatabaseSnapshot {
  const material = randomBytes(32);
  const wrapped = wrapLmk(bsk, material, 1);
  material.fill(0);
  return {
    capturedAt: new Date('2026-08-20T12:00:00.000Z'),
    databaseName: 'znvault',
    postgresVersion: '17.5',
    walLsn: '0/16B6C50',
    transactionSnapshot: '100:100:',
    latestMigration: '087_kms_manager_key_read.sql',
    versions: [{
      version: 1,
      keyId: 'LMK_2026_01',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      activatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deprecatedAt: null,
      retiredAt: null,
      description: 'active LMK',
      createdBy: 'operator',
      rotatedFromVersion: null,
      deksMigratedCount: 1,
      deksPendingCount: 0,
      wrappedLmk: wrapped,
    }],
    auditHead: null,
    activeRotation: null,
    backup: {
      id: 'backup_verified_1',
      filename: 'znvault.sql.enc',
      checksum: 'sha256:backup',
      status: 'VERIFIED',
      encrypted: true,
      completedAt: new Date('2026-08-20T11:59:00.000Z'),
      verifiedAt: new Date('2026-08-20T11:59:30.000Z'),
    },
  };
}

/** Returns a valid bundle plus the exact BSK it carries, for assertions. */
function bundleWithKnownKey(): { bundle: Buffer; bsk: Buffer } {
  const bsk = randomBytes(32);
  const bundle = buildLmkEscrowBundle({
    snapshot: makeSnapshot(bsk),
    bsk,
    copyLabel: 'A',
    operator: 'test-operator',
    hostname: 'vault-test',
    vaultVersion: '1.63.7',
    cliVersion: '4.19.0',
    allowUnboundBackup: false,
  });
  return { bundle, bsk };
}

describe('restoreBootstrapKeyFromBundle', () => {
  it('writes the bootstrap key carried by the bundle', () => {
    const { bundle, bsk } = bundleWithKnownKey();
    const target = join(tempDir(), 'lmk.bin');

    restoreBootstrapKeyFromBundle({ bundle, targetPath: target });

    expect(readFileSync(target).equals(bsk)).toBe(true);
  });

  it('writes it owner-only', () => {
    const { bundle } = bundleWithKnownKey();
    const target = join(tempDir(), 'lmk.bin');

    restoreBootstrapKeyFromBundle({ bundle, targetPath: target });

    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('reports the restore without ever exposing key material', () => {
    const { bundle, bsk } = bundleWithKnownKey();
    const target = join(tempDir(), 'lmk.bin');

    const report = restoreBootstrapKeyFromBundle({ bundle, targetPath: target });

    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(bsk.toString('hex'));
    expect(serialised).not.toContain(bsk.toString('base64'));
    expect(report.bskSha256).toBe(createHash('sha256').update(bsk).digest('hex'));
  });

  it('is a no-op when the target already holds the same key', () => {
    const { bundle, bsk } = bundleWithKnownKey();
    const target = join(tempDir(), 'lmk.bin');
    writeFileSync(target, bsk, { mode: 0o600 });

    const report = restoreBootstrapKeyFromBundle({ bundle, targetPath: target });

    expect(report.outcome).toBe('ALREADY_PRESENT');
    expect(readFileSync(target).equals(bsk)).toBe(true);
  });

  it('refuses to overwrite a different bootstrap key, and leaves it untouched', () => {
    const { bundle } = bundleWithKnownKey();
    const target = join(tempDir(), 'lmk.bin');
    const live = randomBytes(32);
    writeFileSync(target, live, { mode: 0o600 });

    expect(() => restoreBootstrapKeyFromBundle({ bundle, targetPath: target })).toThrow(
      /different/i,
    );

    expect(readFileSync(target).equals(live)).toBe(true);
  });

  it('writes nothing when the bundle is corrupted', () => {
    const { bundle } = bundleWithKnownKey();
    bundle[bundle.length - 1] ^= 0xff; // break the trailing digest
    const dir = tempDir();
    const target = join(dir, 'lmk.bin');

    expect(() => restoreBootstrapKeyFromBundle({ bundle, targetPath: target })).toThrow();

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves no temporary file behind on success', () => {
    const { bundle } = bundleWithKnownKey();
    const dir = tempDir();

    restoreBootstrapKeyFromBundle({ bundle, targetPath: join(dir, 'lmk.bin') });

    expect(readdirSync(dir)).toEqual(['lmk.bin']);
  });
});
