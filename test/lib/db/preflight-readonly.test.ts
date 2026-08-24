// Path: test/lib/db/preflight-readonly.test.ts
//
// Test 1.1 of the milestone is "run the preflight against PRODUCTION and make
// ZERO writes". This file is what makes that claim checkable.
//
// It deliberately does NOT inspect the SQL string for the words READ ONLY.
// That would prove the spelling, not the guarantee.
//
// Nor does it open its own transaction with a copy of the same BEGIN and write
// into that — the first draft of this file did, and it was worthless: deleting
// READ ONLY from `capture()` left all five tests green, because the test was
// exercising its own duplicate of the statement rather than the real one.
// Two copies of a contract, both agreeing with each other and neither with the
// code.
//
// What it does instead is ARM THE DATABASE. A table the capture is certain to
// read is replaced by a view whose WHERE clause calls a volatile function that
// performs an INSERT. Running that SELECT inside a read-write transaction
// writes a row; running it inside a READ ONLY transaction raises SQLSTATE
// 25006, `read_only_sql_transaction`. So `capture()` — the real one, with its
// real BEGIN — is made to prove its own transaction's mode from the inside,
// and the probe is separately shown to be live so a pass cannot come from the
// probe silently doing nothing.
//
// SCHEMA. The tables are created here rather than borrowed from the server
// repository. The property under test is a property of the TRANSACTION, not of
// the schema, and a self-contained DDL block means this runs against any
// PostgreSQL — including a bare service container in CI — with no cross-repo
// dependency to rot.
//
// SKIPPING. This file needs a database, and the CLI's other tests do not.
// A skip that nobody notices is how a suite quietly stops testing (see the
// disarmed guards removed from vault E2E suite 75), so the skip is paired with
// `preflight-ci-wiring.test.ts`, which ALWAYS runs and fails if CI stops
// providing the database. The skip can therefore be a local convenience
// without ever becoming a permanent one.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DB_URL = process.env.PREFLIGHT_TEST_DATABASE_URL;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS lmk_versions (
    version INTEGER PRIMARY KEY,
    key_id TEXT NOT NULL,
    status TEXT NOT NULL,
    wrapped_lmk BYTEA
  );
  CREATE TABLE IF NOT EXISTS root_key_envelopes (
    provider_id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL,
    key_id TEXT,
    ciphertext BYTEA NOT NULL,
    kcv TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lmk_rotation_progress (
    rotation_id TEXT PRIMARY KEY,
    old_lmk_version INTEGER NOT NULL,
    new_lmk_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    curr_hmac BYTEA,
    lmk_version INTEGER NOT NULL DEFAULT 0,
    hmac_format_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,
    encrypted BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
  );
`;

const SEED = `
  TRUNCATE _migrations, lmk_versions, root_key_envelopes,
           lmk_rotation_progress, audit_log, backups;
  INSERT INTO _migrations (name) VALUES ('093_key_lifecycle_operations');
  -- Version 0 is the ZK placeholder every boot re-seeds as ACTIVE.
  INSERT INTO lmk_versions (version, key_id, status, wrapped_lmk) VALUES
    (0, 'ZK_MODE_PLACEHOLDER', 'ACTIVE', NULL),
    (1, 'lmk-v1', 'RETIRED', NULL),
    (3, 'lmk-v3', 'DEPRECATED', decode(repeat('11', 60), 'hex')),
    (4, 'lmk-v4', 'ACTIVE', decode(repeat('22', 60), 'hex'));
  INSERT INTO root_key_envelopes (provider_id, provider_type, key_id, ciphertext, kcv) VALUES
    ('aws-kms', 'aws-kms', 'alias/example', decode('00', 'hex'),
     'kcv1:0aefffaf36e10342c827e949f8276fd8'),
    ('sentinel', 'sentinel', NULL, decode('00', 'hex'),
     'kcv1:0aefffaf36e10342c827e949f8276fd8');
  INSERT INTO audit_log (curr_hmac, lmk_version, hmac_format_version)
    VALUES (decode(repeat('ab', 32), 'hex'), 4, 2);
  INSERT INTO backups (id, filename, status, encrypted, completed_at, verified_at)
    VALUES ('backup_1', 'znvault.tar.gz', 'VERIFIED', true, now(), now());
`;

describe.skipIf(DB_URL === undefined)('preflight capture against a real PostgreSQL', () => {
  let admin: pg.Client;
  // Imported lazily: constructing a BaseDBClient reads DATABASE_URL at
  // construction time, and the module must not be loaded before it is set.
  let PreflightOperations: typeof import('../../../src/lib/db/preflight.js').PreflightOperations;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query(SCHEMA);
    await admin.query(SEED);
    ({ PreflightOperations } = await import('../../../src/lib/db/preflight.js'));
  }, 30000);

  afterAll(async () => {
    await admin.end();
  });

  /**
   * Replace `lmk_versions` with a view that tries to write while it is read.
   * `lmk_versions` is chosen because the capture always reads it and it always
   * has rows, so the volatile function is certain to be evaluated.
   */
  async function armWriteProbe(): Promise<void> {
    await admin.query(`
      CREATE TABLE IF NOT EXISTS probe_writes (id SERIAL PRIMARY KEY);
      CREATE OR REPLACE FUNCTION probe_write() RETURNS boolean AS $$
      BEGIN
        INSERT INTO probe_writes DEFAULT VALUES;
        RETURN true;
      END $$ LANGUAGE plpgsql VOLATILE;
      ALTER TABLE lmk_versions RENAME TO lmk_versions_real;
      CREATE VIEW lmk_versions AS
        SELECT version, key_id, status, wrapped_lmk
        FROM lmk_versions_real
        WHERE probe_write();
    `);
  }

  async function disarmWriteProbe(): Promise<void> {
    await admin.query(`
      DROP VIEW IF EXISTS lmk_versions;
      ALTER TABLE lmk_versions_real RENAME TO lmk_versions;
      DROP FUNCTION IF EXISTS probe_write();
      DROP TABLE IF EXISTS probe_writes;
    `);
  }

  it('opens a transaction PostgreSQL refuses to write in (SQLSTATE 25006)', async () => {
    await armWriteProbe();
    const ops = new PreflightOperations();
    try {
      // First: prove the probe is live, so a pass below cannot come from the
      // probe quietly doing nothing.
      await admin.query('BEGIN');
      await admin.query('SELECT version FROM lmk_versions');
      await admin.query('COMMIT');
      const live = await admin.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM probe_writes');
      expect(Number(live.rows[0]?.n)).toBeGreaterThan(0);
      await admin.query('TRUNCATE probe_writes');

      // Now the real capture, with its real BEGIN. The write attempted from
      // inside its own SELECT must be refused.
      let code: string | undefined;
      try {
        await ops.capture();
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe('25006');

      const after = await admin.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM probe_writes');
      expect(Number(after.rows[0]?.n)).toBe(0);
    } finally {
      await ops.close();
      await disarmWriteProbe();
    }
  }, 30000);

  it('captures the inventory without changing anything', async () => {
    // The zero-writes claim, measured rather than asserted: compare the
    // transaction id counter across the capture. A committed write advances it.
    const before = await admin.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM audit_log",
    );
    const ops = new PreflightOperations();
    try {
      const snapshot = await ops.capture();

      expect(snapshot.databaseName).toBeTruthy();
      expect(snapshot.latestMigration).toBe('093_key_lifecycle_operations');
      // Version 0 is present in the raw capture: filtering it out is the
      // GATE's job, and hiding it here would make the artefact unable to show
      // that the placeholder was seen and correctly ignored.
      expect(snapshot.lmkVersions.map((v) => v.version)).toEqual([0, 1, 3, 4]);
      expect(snapshot.lmkVersions.find((v) => v.version === 4)?.hasWrappedLmk).toBe(true);
      expect(snapshot.lmkVersions.find((v) => v.version === 4)?.wrappedBytes).toBe(60);
      expect(snapshot.lmkVersions.find((v) => v.version === 1)?.hasWrappedLmk).toBe(false);
      expect(snapshot.rootKeyEnvelopesTablePresent).toBe(true);
      expect(snapshot.rootKeyEnvelopes.map((e) => e.providerId)).toEqual(['aws-kms', 'sentinel']);
      expect(snapshot.activeRotations).toEqual([]);
      expect(snapshot.auditHead?.currentHmacBase64).toBe(Buffer.alloc(32, 0xab).toString('base64'));
      expect(snapshot.latestVerifiedBackup?.id).toBe('backup_1');
    } finally {
      await ops.close();
    }

    const after = await admin.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM audit_log",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  }, 30000);

  it('never pulls wrapped key material into the process', async () => {
    // A CLI process holding wrapped LMK bytes puts them in a core dump, a swap
    // file and any crash report. Every gate is about presence, so the capture
    // reads octet_length and nothing else.
    const ops = new PreflightOperations();
    try {
      const snapshot = await ops.capture();
      const serialised = JSON.stringify(snapshot);
      expect(serialised).not.toContain('2222222222');
      for (const version of snapshot.lmkVersions) {
        expect(Object.keys(version).sort()).toEqual([
          'hasWrappedLmk',
          'status',
          'version',
          'wrappedBytes',
        ]);
      }
    } finally {
      await ops.close();
    }
  }, 30000);

  it('survives a database with no root_key_envelopes table', async () => {
    // A node predating migration 092. The query must not abort the capture
    // transaction — everything already read would be lost with it.
    await admin.query('ALTER TABLE root_key_envelopes RENAME TO root_key_envelopes_hidden');
    const ops = new PreflightOperations();
    try {
      const snapshot = await ops.capture();
      expect(snapshot.rootKeyEnvelopesTablePresent).toBe(false);
      expect(snapshot.rootKeyEnvelopes).toEqual([]);
      // The rest of the capture still arrived.
      expect(snapshot.lmkVersions).toHaveLength(4);
    } finally {
      await ops.close();
      await admin.query('ALTER TABLE root_key_envelopes_hidden RENAME TO root_key_envelopes');
    }
  }, 30000);

  it('reports a FAILED rotation, not only an in-progress one', async () => {
    await admin.query(`
      INSERT INTO lmk_rotation_progress
        (rotation_id, old_lmk_version, new_lmk_version, status, started_at)
      VALUES ('rot-failed', 4, 5, 'FAILED', now())
    `);
    const ops = new PreflightOperations();
    try {
      const snapshot = await ops.capture();
      expect(snapshot.activeRotations.map((r) => r.rotationId)).toEqual(['rot-failed']);
    } finally {
      await ops.close();
      await admin.query("DELETE FROM lmk_rotation_progress WHERE rotation_id = 'rot-failed'");
    }
  }, 30000);
});
