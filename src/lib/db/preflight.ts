// Path: src/lib/db/preflight.ts

import { BaseDBClient } from './client.js';
import type {
  PreflightAuditHead,
  PreflightBackup,
  PreflightEnvelope,
  PreflightLmkVersion,
  PreflightRotation,
} from '../preflight.js';

export interface PreflightDatabaseSnapshot {
  capturedAt: Date;
  databaseName: string;
  postgresVersion: string;
  walLsn: string;
  transactionSnapshot: string;
  latestMigration: string | null;
  lmkVersions: PreflightLmkVersion[];
  rootKeyEnvelopes: PreflightEnvelope[];
  rootKeyEnvelopesTablePresent: boolean;
  activeRotations: PreflightRotation[];
  auditHead: PreflightAuditHead | null;
  latestVerifiedBackup: PreflightBackup | null;
}

interface IdentityRow {
  capturedAt: Date;
  databaseName: string;
  postgresVersion: string;
  walLsn: string;
  transactionSnapshot: string;
  latestMigration: string | null;
  rootKeyEnvelopesTable: string | null;
}

interface VersionRow {
  version: number;
  status: string;
  wrappedBytes: string | number | null;
}

interface EnvelopeRow {
  providerId: string;
  providerType: string;
  keyId: string | null;
  kcv: string;
}

interface RotationRow {
  rotationId: string;
  oldLmkVersion: number;
  newLmkVersion: number;
  status: string;
  startedAt: Date | null;
}

interface AuditHeadRow {
  id: string;
  timestamp: Date | null;
  currentHmac: Buffer;
  lmkVersion: number;
  hmacFormatVersion: number;
}

interface BackupRow {
  id: string;
  filename: string;
  completedAt: Date;
  verifiedAt: Date;
}

/**
 * Capture the key-hierarchy state a BSK rotation depends on.
 *
 * READ ONLY, AND SAID SO TO POSTGRESQL. The transaction is opened
 * `REPEATABLE READ READ ONLY`, which makes any write on this connection fail
 * with SQLSTATE 25006 rather than relying on nobody having added one. Test 1.1
 * of the milestone is "preflight over production, and ZERO writes"; a promise
 * kept only by inspection is not evidence.
 *
 * WHY NOT THE API. `/v1/superadmin/rootkey/status` and `.../verify` each WRITE
 * AN AUDIT ROW. Reading the state through them would break the zero-writes
 * property invisibly — the preflight would be the thing that falsified its own
 * result. This reads PostgreSQL directly, exactly as the escrow snapshot does.
 *
 * REPEATABLE READ, not READ COMMITTED: every query below must see one instant.
 * A version list read before a rotation commits and an envelope list read after
 * would produce an inventory that never existed, and the gates would be
 * evaluated over that.
 *
 * Nothing here selects key material. `wrapped_lmk` is read as `octet_length`
 * only, `root_key_envelopes.ciphertext` is not read at all.
 */
export class PreflightOperations extends BaseDBClient {
  async capture(): Promise<PreflightDatabaseSnapshot> {
    await this.connect();
    const client = this.getRawClient();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    try {
      const identityResult = await client.query<IdentityRow>(`
        SELECT
          clock_timestamp() AS "capturedAt",
          current_database() AS "databaseName",
          current_setting('server_version') AS "postgresVersion",
          pg_current_wal_lsn()::text AS "walLsn",
          txid_current_snapshot()::text AS "transactionSnapshot",
          (SELECT name FROM _migrations ORDER BY name DESC LIMIT 1) AS "latestMigration",
          to_regclass('public.root_key_envelopes')::text AS "rootKeyEnvelopesTable"
      `);
      // pg's types claim `rows[0]` is always present. It is not, and a
      // preflight that reads `undefined.databaseName` reports a crash where it
      // should report an unreadable database.
      const identity = identityResult.rows.at(0);
      if (identity === undefined) {
        throw new Error('Could not read PostgreSQL snapshot identity');
      }

      // octet_length, never the bytes. A preflight that pulled wrapped key
      // material into a CLI process would put it in a core dump, a swap file
      // and an error report, for no gain: every gate here is about presence.
      const versionsResult = await client.query<VersionRow>(`
        SELECT
          version,
          status::text AS status,
          octet_length(wrapped_lmk) AS "wrappedBytes"
        FROM lmk_versions
        ORDER BY version
      `);

      const rootKeyEnvelopesTablePresent = identity.rootKeyEnvelopesTable !== null;
      // A node predating migration 092 has no such table, and `to_regclass`
      // answering NULL is the only safe way to ask — a failing query would
      // abort the whole transaction, losing the reads already taken.
      const envelopesResult = rootKeyEnvelopesTablePresent
        ? await client.query<EnvelopeRow>(`
            SELECT
              provider_id AS "providerId",
              provider_type AS "providerType",
              key_id AS "keyId",
              kcv
            FROM root_key_envelopes
            ORDER BY provider_id
          `)
        : { rows: [] as EnvelopeRow[] };

      const rotationResult = await client.query<RotationRow>(`
        SELECT
          rotation_id AS "rotationId",
          old_lmk_version AS "oldLmkVersion",
          new_lmk_version AS "newLmkVersion",
          status::text AS status,
          started_at AS "startedAt"
        FROM lmk_rotation_progress
        WHERE status IN ('IN_PROGRESS', 'FAILED')
        ORDER BY started_at DESC
      `);

      const auditResult = await client.query<AuditHeadRow>(`
        SELECT
          id::text AS id,
          ts AS timestamp,
          curr_hmac AS "currentHmac",
          lmk_version AS "lmkVersion",
          hmac_format_version AS "hmacFormatVersion"
        FROM audit_log
        WHERE curr_hmac IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `);

      const backupResult = await client.query<BackupRow>(`
        SELECT
          id,
          filename,
          completed_at AS "completedAt",
          verified_at AS "verifiedAt"
        FROM backups
        WHERE deleted_at IS NULL
          AND status::text = 'VERIFIED'
          AND encrypted = true
          AND verified_at IS NOT NULL
          AND completed_at IS NOT NULL
        ORDER BY verified_at DESC
        LIMIT 1
      `);

      await client.query('COMMIT');

      const auditHeadRow = auditResult.rows.at(0);
      const backupRow = backupResult.rows.at(0);

      return {
        capturedAt: identity.capturedAt,
        databaseName: identity.databaseName,
        postgresVersion: identity.postgresVersion,
        walLsn: identity.walLsn,
        transactionSnapshot: identity.transactionSnapshot,
        latestMigration: identity.latestMigration,
        lmkVersions: versionsResult.rows.map((row) => {
          const bytes = row.wrappedBytes === null ? 0 : Number(row.wrappedBytes);
          return {
            version: row.version,
            status: row.status,
            hasWrappedLmk: bytes > 0,
            wrappedBytes: bytes,
          };
        }),
        rootKeyEnvelopes: envelopesResult.rows,
        rootKeyEnvelopesTablePresent,
        activeRotations: rotationResult.rows.map((row) => ({
          rotationId: row.rotationId,
          oldLmkVersion: row.oldLmkVersion,
          newLmkVersion: row.newLmkVersion,
          status: row.status,
          startedAt: row.startedAt?.toISOString() ?? null,
        })),
        auditHead: auditHeadRow !== undefined
          ? {
              id: auditHeadRow.id,
              timestamp: auditHeadRow.timestamp?.toISOString() ?? null,
              currentHmacBase64: Buffer.from(auditHeadRow.currentHmac).toString('base64'),
              lmkVersion: auditHeadRow.lmkVersion,
              hmacFormatVersion: auditHeadRow.hmacFormatVersion,
            }
          : null,
        latestVerifiedBackup: backupRow !== undefined
          ? {
              id: backupRow.id,
              filename: backupRow.filename,
              completedAt: backupRow.completedAt.toISOString(),
              verifiedAt: backupRow.verifiedAt.toISOString(),
            }
          : null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}
