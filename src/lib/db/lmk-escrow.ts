// Path: src/lib/db/lmk-escrow.ts

import { BaseDBClient } from './client.js';

export interface LmkEscrowVersionRow {
  version: number;
  keyId: string;
  status: string;
  createdAt: Date | null;
  activatedAt: Date | null;
  deprecatedAt: Date | null;
  retiredAt: Date | null;
  description: string | null;
  createdBy: string | null;
  rotatedFromVersion: number | null;
  deksMigratedCount: number;
  deksPendingCount: number;
  wrappedLmk: Buffer | null;
}

export interface LmkEscrowBackupBinding {
  id: string;
  filename: string;
  checksum: string;
  status: string;
  encrypted: true;
  completedAt: Date;
  verifiedAt: Date;
}

export interface LmkEscrowAuditHead {
  id: string;
  timestamp: Date | null;
  currentHmac: Buffer;
  lmkVersion: number;
  hmacFormatVersion: number;
}

export interface LmkEscrowActiveRotation {
  rotationId: string;
  oldLmkVersion: number;
  newLmkVersion: number;
  status: string;
  startedAt: Date | null;
}

export interface RootKeyEnvelopeRow {
  providerId: string;
  providerType: string;
  keyId: string | null;
  ciphertext: Buffer;
  kcv: string;
}

export interface LmkEscrowDatabaseSnapshot {
  capturedAt: Date;
  databaseName: string;
  postgresVersion: string;
  walLsn: string;
  transactionSnapshot: string;
  latestMigration: string | null;
  versions: LmkEscrowVersionRow[];
  auditHead: LmkEscrowAuditHead | null;
  activeRotation: LmkEscrowActiveRotation | null;
  backup: LmkEscrowBackupBinding | null;
}

interface DatabaseIdentityRow {
  capturedAt: Date;
  databaseName: string;
  postgresVersion: string;
  walLsn: string;
  transactionSnapshot: string;
  latestMigration: string | null;
}

interface LmkEscrowBackupRow {
  id: string;
  filename: string;
  checksum: string | null;
  status: string;
  encrypted: boolean;
  completedAt: Date | null;
  verifiedAt: Date | null;
}

/**
 * Read the BSK-adjacent PostgreSQL state in one repeatable-read transaction.
 * This class never unwraps LMKs and never writes to PostgreSQL.
 */
export class LmkEscrowOperations extends BaseDBClient {
  /**
   * Read one root-key envelope, for sourcing the BSK from the hardware root
   * instead of a cleartext file.
   *
   * `kcv` is the load-bearing column: it is what the returned key is checked
   * against, and the appliance neither supplies it nor can influence it at read
   * time. See `resolveBskFromProvider`.
   */
  async getRootKeyEnvelope(providerId: string): Promise<RootKeyEnvelopeRow | null> {
    await this.connect();
    const result = await this.getRawClient().query<RootKeyEnvelopeRow>(
      `SELECT provider_id AS "providerId",
              provider_type AS "providerType",
              key_id AS "keyId",
              ciphertext,
              kcv
         FROM root_key_envelopes
        WHERE provider_id = $1`,
      [providerId],
    );
    return result.rows[0] ?? null;
  }

  /** Provider ids that have an envelope, for a useful "did you mean" on error. */
  async listRootKeyEnvelopeProviders(): Promise<string[]> {
    await this.connect();
    const result = await this.getRawClient().query<{ providerId: string }>(
      `SELECT provider_id AS "providerId" FROM root_key_envelopes ORDER BY provider_id`,
    );
    return result.rows.map((r) => r.providerId);
  }

  async capture(backupId?: string): Promise<LmkEscrowDatabaseSnapshot> {
    await this.connect();
    const client = this.getRawClient();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    try {
      const identityResult = await client.query<DatabaseIdentityRow>(`
        SELECT
          clock_timestamp() AS "capturedAt",
          current_database() AS "databaseName",
          current_setting('server_version') AS "postgresVersion",
          pg_current_wal_lsn()::text AS "walLsn",
          txid_current_snapshot()::text AS "transactionSnapshot",
          (SELECT name FROM _migrations ORDER BY name DESC LIMIT 1) AS "latestMigration"
      `);
      if (identityResult.rows.length !== 1) {
        throw new Error('Could not read PostgreSQL snapshot identity');
      }
      const identity = identityResult.rows[0];

      const versionsResult = await client.query<LmkEscrowVersionRow>(`
        SELECT
          version,
          key_id AS "keyId",
          status::text AS status,
          created_at AS "createdAt",
          activated_at AS "activatedAt",
          deprecated_at AS "deprecatedAt",
          retired_at AS "retiredAt",
          description,
          created_by AS "createdBy",
          rotated_from_version AS "rotatedFromVersion",
          COALESCE(deks_migrated_count, 0) AS "deksMigratedCount",
          COALESCE(deks_pending_count, 0) AS "deksPendingCount",
          wrapped_lmk AS "wrappedLmk"
        FROM lmk_versions
        WHERE version > 0
        ORDER BY version
      `);

      const auditResult = await client.query<LmkEscrowAuditHead>(`
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

      const rotationResult = await client.query<LmkEscrowActiveRotation>(`
        SELECT
          rotation_id AS "rotationId",
          old_lmk_version AS "oldLmkVersion",
          new_lmk_version AS "newLmkVersion",
          status::text AS status,
          started_at AS "startedAt"
        FROM lmk_rotation_progress
        WHERE status IN ('IN_PROGRESS', 'FAILED')
        ORDER BY started_at DESC
        LIMIT 1
      `);

      let backup: LmkEscrowBackupBinding | null = null;
      if (backupId !== undefined) {
        const backupResult = await client.query<LmkEscrowBackupRow>(`
          SELECT
            id,
            filename,
            checksum,
            status::text AS status,
            encrypted,
            completed_at AS "completedAt",
            verified_at AS "verifiedAt"
          FROM backups
          WHERE id = $1
            AND deleted_at IS NULL
        `, [backupId]);
        if (backupResult.rows.length === 0) {
          throw new Error(`Backup ${backupId} was not found or has been deleted`);
        }
        const backupRow = backupResult.rows[0];
        if (
          backupRow.status !== 'VERIFIED' ||
          !backupRow.encrypted ||
          backupRow.checksum === null ||
          backupRow.checksum === '' ||
          backupRow.completedAt === null ||
          backupRow.verifiedAt === null
        ) {
          throw new Error(`Backup ${backupId} must be encrypted, VERIFIED and have a checksum`);
        }
        backup = {
          ...backupRow,
          checksum: backupRow.checksum,
          encrypted: true,
          completedAt: backupRow.completedAt,
          verifiedAt: backupRow.verifiedAt,
        };
      }

      await client.query('COMMIT');
      return {
        ...identity,
        versions: versionsResult.rows,
        auditHead: auditResult.rows[0] ?? null,
        activeRotation: rotationResult.rows[0] ?? null,
        backup,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}
