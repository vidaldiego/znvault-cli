// Path: test/lib/restore-drill-integration.test.ts
//
// The `pre` gate against a REAL escrow bundle and a REAL PostgreSQL.
//
// The pure gate tests next door prove the decisions. This one proves the two
// things that only appear when the parts are joined: that the numbers read out
// of a genuine bundle line up with the columns read out of a genuine database,
// and that the gate fires on the state a botched restore actually leaves — an
// empty `lmk_versions` — rather than on a hand-built object shaped like it.
//
// The `post` gate needs a running vault, which is what the lab script in
// zn-vault's deploy/lab/isolated-restore/ exists to drive. It is not simulated
// here; a fake would only prove the fake.
//
// Skips without DRILL_TEST_DATABASE_URL, and CI is asserted to provide it
// by test/lib/restore-drill-ci-wiring.test.ts, which always runs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

import { buildLmkEscrowBundle, readAndVerifyLmkEscrowBundle } from '../../src/lib/lmk-escrow.js';
import type { LmkEscrowDatabaseSnapshot } from '../../src/lib/db/lmk-escrow.js';
import {
  assertRestoredDatabaseIsRecoverable,
  type RestoredLmkVersion,
} from '../../src/lib/restore-drill.js';

const DB_URL = process.env.DRILL_TEST_DATABASE_URL;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lmk_versions (
    version INTEGER PRIMARY KEY,
    key_id TEXT NOT NULL,
    status TEXT NOT NULL,
    wrapped_lmk BYTEA
  );
`;

function wrapLmk(bsk: Buffer, material: Buffer, version: number): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bsk, nonce);
  cipher.setAAD(Buffer.from(`lmk_version=${String(version)}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
  return Buffer.concat([Buffer.from([0x01]), nonce, ciphertext, cipher.getAuthTag()]);
}

/** A bundle shaped like production: a historical gap at v1, ACTIVE at v4. */
function makeSnapshot(bsk: Buffer): LmkEscrowDatabaseSnapshot {
  const wrapped3 = wrapLmk(bsk, randomBytes(32), 3);
  const wrapped4 = wrapLmk(bsk, randomBytes(32), 4);
  return {
    capturedAt: new Date('2026-08-23T12:00:00.000Z'),
    databaseName: 'znvault',
    postgresVersion: '17.5',
    walLsn: '0/16B6C50',
    transactionSnapshot: '100:100:',
    latestMigration: '094_single_active_lmk_version',
    versions: [
      {
        version: 1, keyId: 'LMK_2025_01', status: 'RETIRED',
        createdAt: null, activatedAt: null, deprecatedAt: null, retiredAt: null,
        description: null, createdBy: null, rotatedFromVersion: null,
        deksMigratedCount: 0, deksPendingCount: 0, wrappedLmk: null,
      },
      {
        version: 3, keyId: 'LMK_2026_03', status: 'DEPRECATED',
        createdAt: null, activatedAt: null, deprecatedAt: null, retiredAt: null,
        description: null, createdBy: null, rotatedFromVersion: null,
        deksMigratedCount: 0, deksPendingCount: 0, wrappedLmk: wrapped3,
      },
      {
        version: 4, keyId: 'LMK_2026_04', status: 'ACTIVE',
        createdAt: null, activatedAt: null, deprecatedAt: null, retiredAt: null,
        description: null, createdBy: null, rotatedFromVersion: null,
        deksMigratedCount: 0, deksPendingCount: 0, wrappedLmk: wrapped4,
      },
    ],
    auditHead: null,
    activeRotation: null,
    backup: null,
  };
}

async function readVersions(client: pg.Client): Promise<RestoredLmkVersion[]> {
  const result = await client.query<{ version: number; status: string; wrapped: string | null }>(
    `SELECT version, status, octet_length(wrapped_lmk) AS wrapped
       FROM lmk_versions ORDER BY version`,
  );
  return result.rows.map((row) => ({
    version: row.version,
    status: row.status,
    hasWrappedLmk: row.wrapped !== null && Number(row.wrapped) > 0,
  }));
}

describe.skipIf(DB_URL === undefined)('restore drill, pre-boot gate, end to end', () => {
  let client: pg.Client;
  let dir: string;
  let bundlePath: string;
  let expectedKcv: string;
  let expectedActive: number;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    await client.query(SCHEMA);

    dir = mkdtempSync(join(tmpdir(), 'znvault-drill-'));
    bundlePath = join(dir, 'escrow.bin');
    const bsk = randomBytes(32);
    const bundle = buildLmkEscrowBundle({
      snapshot: makeSnapshot(bsk),
      bsk,
      copyLabel: 'A',
      operator: 'drill-test',
      hostname: 'bench',
      vaultVersion: '1.66.0',
      cliVersion: '4.21.0',
      allowUnboundBackup: true,
    });
    writeFileSync(bundlePath, bundle, { mode: 0o600 });
    bsk.fill(0);
    bundle.fill(0);

    const report = readAndVerifyLmkEscrowBundle(bundlePath);
    expectedKcv = report.bskKcv;
    expectedActive = report.activeLmkVersion;
  }, 30000);

  afterAll(async () => {
    await client.end();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await client.query('TRUNCATE lmk_versions');
  });

  /** What a successful dump restore leaves behind. */
  async function seedRestoredDatabase(): Promise<void> {
    await client.query(`
      INSERT INTO lmk_versions (version, key_id, status, wrapped_lmk) VALUES
        (0, 'ZK_MODE_PLACEHOLDER', 'ACTIVE', NULL),
        (1, 'LMK_2025_01', 'RETIRED', NULL),
        (3, 'LMK_2026_03', 'DEPRECATED', decode(repeat('11', 61), 'hex')),
        (4, 'LMK_2026_04', 'ACTIVE', decode(repeat('22', 61), 'hex'))
    `);
  }

  it('reads a real bundle and a real database and agrees they match', async () => {
    await seedRestoredDatabase();

    const versions = await readVersions(client);

    expect(expectedKcv).toMatch(/^kcv1:[0-9a-f]{32}$/);
    expect(expectedActive).toBe(4);
    expect(() => assertRestoredDatabaseIsRecoverable(versions, expectedActive)).not.toThrow();
  }, 30000);

  it('fires on the state a botched restore actually leaves', async () => {
    // Not a hand-built object shaped like an empty table — an actually empty
    // table, read through the same query the command uses. This is the case
    // where starting the vault would mint a new LMK and report success.
    const versions = await readVersions(client);
    expect(versions).toEqual([]);

    expect(() => assertRestoredDatabaseIsRecoverable(versions, expectedActive)).toThrow(/mint/i);
  }, 30000);

  it('fires when the dump predates the bundle', async () => {
    // A real hazard on a bench: the most recent dump to hand is not necessarily
    // the one the bundle was taken alongside.
    await client.query(`
      INSERT INTO lmk_versions (version, key_id, status, wrapped_lmk) VALUES
        (0, 'ZK_MODE_PLACEHOLDER', 'ACTIVE', NULL),
        (3, 'LMK_2026_03', 'ACTIVE', decode(repeat('11', 61), 'hex'))
    `);

    const versions = await readVersions(client);

    expect(() => assertRestoredDatabaseIsRecoverable(versions, expectedActive)).toThrow(
      /different moments|version 3/i,
    );
  }, 30000);

  it('fires when the rows came back but the key material did not', async () => {
    // A dump restored with `wrapped_lmk` stripped, or a partial column restore.
    // The inventory looks right at a glance and the vault still mints.
    await client.query(`
      INSERT INTO lmk_versions (version, key_id, status, wrapped_lmk) VALUES
        (0, 'ZK_MODE_PLACEHOLDER', 'ACTIVE', NULL),
        (4, 'LMK_2026_04', 'ACTIVE', NULL)
    `);

    const versions = await readVersions(client);

    expect(() => assertRestoredDatabaseIsRecoverable(versions, expectedActive)).toThrow(
      /material/i,
    );
  }, 30000);
});
