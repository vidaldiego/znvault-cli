import {
  createCipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LmkEscrowDatabaseSnapshot } from '../../src/lib/db/lmk-escrow.js';
import {
  buildLmkEscrowBundle,
  makeLmkEscrowFilename,
  readAndVerifyLmkEscrowBundle,
  verifyLmkEscrowBundleBuffer,
  writeLmkEscrowBundleDirect,
} from '../../src/lib/lmk-escrow.js';

const temporaryDirectories: string[] = [];

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'znvault-lmk-escrow-'));
  temporaryDirectories.push(directory);
  return directory;
}

function wrapLmk(bsk: Buffer, material: Buffer, version: number): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bsk, nonce);
  cipher.setAAD(Buffer.from(`lmk_version=${String(version)}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
  return Buffer.concat([Buffer.from([0x01]), nonce, ciphertext, cipher.getAuthTag()]);
}

function makeSnapshot(bsk: Buffer, historicalGap = true): LmkEscrowDatabaseSnapshot {
  const material2 = randomBytes(32);
  const material3 = randomBytes(32);
  const wrapped2 = wrapLmk(bsk, material2, 2);
  const wrapped3 = wrapLmk(bsk, material3, 3);
  material2.fill(0);
  material3.fill(0);

  return {
    capturedAt: new Date('2026-08-02T12:00:00.000Z'),
    databaseName: 'znvault',
    postgresVersion: '17.5',
    walLsn: '0/16B6C50',
    transactionSnapshot: '100:100:',
    latestMigration: '087_kms_manager_key_read.sql',
    versions: [
      ...(historicalGap ? [{
        version: 1,
        keyId: 'LMK_2026_01',
        status: 'RETIRED',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        activatedAt: null,
        deprecatedAt: null,
        retiredAt: new Date('2026-02-01T00:00:00.000Z'),
        description: 'historical metadata-only row',
        createdBy: 'system',
        rotatedFromVersion: null,
        deksMigratedCount: 0,
        deksPendingCount: 0,
        wrappedLmk: null,
      }] : []),
      {
        version: 2,
        keyId: 'LMK_2026_02',
        status: historicalGap ? 'RETIRED' : 'DEPRECATED',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        activatedAt: new Date('2026-02-01T00:00:00.000Z'),
        deprecatedAt: new Date('2026-03-01T00:00:00.000Z'),
        retiredAt: historicalGap ? new Date('2026-03-01T00:00:00.000Z') : null,
        description: 'previous LMK',
        createdBy: 'operator',
        rotatedFromVersion: historicalGap ? 1 : null,
        deksMigratedCount: 10,
        deksPendingCount: 0,
        wrappedLmk: wrapped2,
      },
      {
        version: 3,
        keyId: 'LMK_2026_03',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        activatedAt: new Date('2026-03-01T00:00:00.000Z'),
        deprecatedAt: null,
        retiredAt: null,
        description: 'active LMK',
        createdBy: 'operator',
        rotatedFromVersion: 2,
        deksMigratedCount: 10,
        deksPendingCount: 0,
        wrappedLmk: wrapped3,
      },
    ],
    auditHead: {
      id: '42',
      timestamp: new Date('2026-08-02T11:59:59.000Z'),
      currentHmac: randomBytes(32),
      lmkVersion: 3,
      hmacFormatVersion: 2,
    },
    activeRotation: {
      rotationId: 'rotation-test-1',
      oldLmkVersion: 2,
      newLmkVersion: 3,
      status: 'IN_PROGRESS',
      startedAt: new Date('2026-08-02T11:58:00.000Z'),
    },
    backup: {
      id: 'backup_verified_1',
      filename: 'znvault.sql.enc',
      checksum: 'sha256:backup',
      status: 'VERIFIED',
      encrypted: true,
      completedAt: new Date('2026-08-02T11:59:00.000Z'),
      verifiedAt: new Date('2026-08-02T11:59:30.000Z'),
    },
  };
}

function buildBundle(historicalGap = true): { bundle: Buffer; wrappedActive: Buffer } {
  const bsk = randomBytes(32);
  const snapshot = makeSnapshot(bsk, historicalGap);
  const wrappedActive = Buffer.from(snapshot.versions.at(-1)?.wrappedLmk ?? Buffer.alloc(0));
  const bundle = buildLmkEscrowBundle({
    snapshot,
    bsk,
    copyLabel: 'A',
    operator: 'test-operator',
    hostname: 'vault-test',
    vaultVersion: '1.63.0',
    cliVersion: '4.18.1',
    allowUnboundBackup: false,
  });
  bsk.fill(0);
  return { bundle, wrappedActive };
}

function replaceBundleBytes(bundle: Buffer, from: string, to: string): void {
  const source = Buffer.from(from, 'utf8');
  const replacement = Buffer.from(to, 'utf8');
  if (source.length !== replacement.length) {
    throw new Error('Test replacement must preserve the bundle length');
  }
  const offset = bundle.indexOf(source);
  if (offset < 0) throw new Error(`Could not find ${from} in test bundle`);
  replacement.copy(bundle, offset);
  const bodyEnd = bundle.length - 32;
  createHash('sha256').update(bundle.subarray(0, bodyEnd)).digest().copy(bundle, bodyEnd);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('LMK escrow binary format', () => {
  it('requires explicit lab mode when no VERIFIED backup is bound', () => {
    const bsk = randomBytes(32);
    const snapshot = makeSnapshot(bsk);
    snapshot.backup = null;
    expect(() => buildLmkEscrowBundle({
      snapshot,
      bsk,
      copyLabel: 'A',
      operator: 'test-operator',
      hostname: 'vault-test',
      vaultVersion: '1.63.0',
      cliVersion: '4.18.1',
      allowUnboundBackup: false,
    })).toThrow(/VERIFIED backup binding/i);
    bsk.fill(0);
  });

  it('rejects a backup that predates the in-progress rotation', () => {
    const bsk = randomBytes(32);
    const snapshot = makeSnapshot(bsk);
    if (snapshot.backup !== null) {
      snapshot.backup.completedAt = new Date('2026-08-02T11:00:00.000Z');
    }
    expect(() => buildLmkEscrowBundle({
      snapshot,
      bsk,
      copyLabel: 'A',
      operator: 'test-operator',
      hostname: 'vault-test',
      vaultVersion: '1.63.0',
      cliVersion: '4.18.1',
      allowUnboundBackup: false,
    })).toThrow(/predates active rotation/i);
    bsk.fill(0);
  });

  it('authenticates the BSK against every recoverable LMK and reports historical gaps', () => {
    const { bundle } = buildBundle();
    try {
      const report = verifyLmkEscrowBundleBuffer(bundle);
      expect(report.valid).toBe(true);
      expect(report.activeLmkVersion).toBe(3);
      expect(report.recoverableVersions).toEqual([2, 3]);
      expect(report.unrecoverableVersions).toEqual([1]);
      expect(report.recoverability).toBe('KNOWN_HISTORICAL_GAPS');
      expect(report.backupId).toBe('backup_verified_1');
      expect(report.activeRotationId).toBe('rotation-test-1');
    } finally {
      bundle.fill(0);
    }
  });

  it('reports complete recoverability when every positive LMK has wrapped material', () => {
    const { bundle } = buildBundle(false);
    try {
      const report = verifyLmkEscrowBundleBuffer(bundle);
      expect(report.recoverability).toBe('COMPLETE');
      expect(report.unrecoverableVersions).toEqual([]);
      expect(report.recoverableVersions).toEqual([2, 3]);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects a truncated bundle', () => {
    const { bundle } = buildBundle();
    try {
      expect(() => verifyLmkEscrowBundleBuffer(bundle.subarray(0, bundle.length - 17)))
        .toThrow(/checksum|truncated/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects ordinary corruption before parsing key material', () => {
    const { bundle } = buildBundle();
    try {
      bundle[Math.floor(bundle.length / 2)] ^= 0x01;
      expect(() => verifyLmkEscrowBundleBuffer(bundle)).toThrow(/checksum mismatch/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects wrapped-LMK tampering even if an attacker recomputes the file checksum', () => {
    const { bundle, wrappedActive } = buildBundle();
    try {
      const wrappedOffset = bundle.indexOf(wrappedActive);
      expect(wrappedOffset).toBeGreaterThan(0);
      bundle[wrappedOffset + 20] ^= 0x01;
      const bodyEnd = bundle.length - 32;
      createHash('sha256').update(bundle.subarray(0, bodyEnd)).digest().copy(bundle, bodyEnd);
      expect(() => verifyLmkEscrowBundleBuffer(bundle)).toThrow(/cannot be authenticated/i);
    } finally {
      wrappedActive.fill(0);
      bundle.fill(0);
    }
  });

  it('rejects an active-version summary that disagrees with the inventory', () => {
    const { bundle } = buildBundle();
    try {
      replaceBundleBytes(bundle, '"activeLmkVersion":3', '"activeLmkVersion":2');
      expect(() => verifyLmkEscrowBundleBuffer(bundle)).toThrow(/ACTIVE LMK version.*summary/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects unsafe receipt metadata even with a recomputed file checksum', () => {
    const { bundle } = buildBundle();
    try {
      replaceBundleBytes(bundle, '"copyLabel":"A"', '"copyLabel":"!"');
      expect(() => verifyLmkEscrowBundleBuffer(bundle)).toThrow(/copy label/i);
    } finally {
      bundle.fill(0);
    }
  });
});

describe('direct escrow write', () => {
  it('writes only the final file, reads it back and refuses overwrite', () => {
    const directory = makeTempDirectory();
    const { bundle } = buildBundle();
    try {
      const report = verifyLmkEscrowBundleBuffer(bundle);
      const filename = makeLmkEscrowFilename(report);
      const receipt = writeLmkEscrowBundleDirect(bundle, {
        mountPath: directory,
        filename,
        requireDedicatedMount: false,
      });

      expect(receipt.path).toBe(join(realpathSync(directory), filename));
      expect(receipt.bytes).toBe(bundle.length);
      expect(readdirSync(directory)).toEqual([filename]);
      expect(readAndVerifyLmkEscrowBundle(receipt.path).bundleId).toBe(receipt.bundleId);
      expect(() => writeLmkEscrowBundleDirect(bundle, {
        mountPath: directory,
        filename,
        requireDedicatedMount: false,
      })).toThrow(/EEXIST|exist/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects a symlink destination', () => {
    const root = makeTempDirectory();
    const realDirectory = makeTempDirectory();
    const linkedDirectory = join(root, 'device');
    symlinkSync(realDirectory, linkedDirectory);
    const { bundle } = buildBundle();
    try {
      const filename = makeLmkEscrowFilename(verifyLmkEscrowBundleBuffer(bundle));
      expect(() => writeLmkEscrowBundleDirect(bundle, {
        mountPath: linkedDirectory,
        filename,
        requireDedicatedMount: false,
      })).toThrow(/symlink/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects an ordinary directory when a dedicated removable mount is required', () => {
    const directory = makeTempDirectory();
    const { bundle } = buildBundle();
    try {
      const filename = makeLmkEscrowFilename(verifyLmkEscrowBundleBuffer(bundle));
      expect(() => writeLmkEscrowBundleDirect(bundle, {
        mountPath: directory,
        filename,
      })).toThrow(/Volumes|media|mnt|mounted filesystem/i);
    } finally {
      bundle.fill(0);
    }
  });

  it('rejects a partial file during a later verification pass', () => {
    const directory = makeTempDirectory();
    const file = join(directory, 'partial.znlmk');
    const { bundle } = buildBundle();
    try {
      writeFileSync(file, bundle.subarray(0, Math.floor(bundle.length / 2)), { mode: 0o600 });
      const persisted = readFileSync(file);
      expect(persisted.length).toBeLessThan(bundle.length);
      expect(() => readAndVerifyLmkEscrowBundle(file)).toThrow(/checksum|truncated/i);
    } finally {
      bundle.fill(0);
    }
  });
});
