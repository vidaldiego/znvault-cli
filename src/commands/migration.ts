// Path: znvault-cli/src/commands/migration.ts

/**
 * `znvault migration apply/status` — drive schema migrations against a
 * dynamic-secrets-backed database via `@zincapp/znvault-migrate`.
 *
 * The `<config>` argument is a path to a JSON file containing EITHER:
 *   - a single MigrationConfig object, or
 *   - an array of MigrationConfig objects (multiple phases, applied in order).
 *
 * `apply` mints a lease per phase (via the package's own lease/run-migrations
 * lifecycle: 4h TTL, always-revoke, signal handlers) and runs pending
 * migrations. `status` is read-only: it mints its own short-lived lease,
 * opens a connection, calls MigrationRunner.status(), and ALWAYS revokes the
 * lease in a finally block — the package does not expose a status-only path
 * through `runMigrations` (which unconditionally calls `run()`), so this
 * command replicates the lease→connect→status→revoke cycle directly using
 * the same building blocks (`mysqlAdapter`, `MigrationRunner`) plus the CLI's
 * own authenticated `client` to mint/revoke the lease.
 *
 * Only `engine: 'mysql'` is supported end-to-end. A `postgres` config is
 * rejected by `validateMigrationConfig` (the §5 deferred-adapter error) before
 * any lease is minted.
 */

import { type Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import {
  runMigrations,
  defaultDeps,
  validateMigrationConfig,
  mysqlAdapter,
  MigrationRunner,
  type MigrationConfig,
} from '@zincapp/znvault-migrate';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

/**
 * Minimal shape of a dynamic-secrets credential response used by `status`.
 *
 * `host`/`port` are typed optional even though the server is expected to
 * always return them — this is a defensive type matching the actual runtime
 * contract of a JSON HTTP response (never guaranteed by TypeScript alone),
 * mirroring the same guard in `src/commands/mysql/broker.ts`.
 */
interface StatusLeaseCredential {
  leaseId: string;
  username: string;
  password: string;
  host?: string;
  port?: number;
  database?: string;
}

/** Lease TTL for the read-only `status` command — short-lived, best-effort. */
const STATUS_LEASE_TTL_SECONDS = 300;

/**
 * Read and parse a JSON migration config file, normalizing a single object
 * into a one-element array.
 *
 * @throws If the file cannot be read or does not contain valid JSON.
 */
function readConfigFile(configPath: string): MigrationConfig[] {
  const absPath = resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read migration config file '${absPath}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Migration config file '${absPath}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return Array.isArray(parsed) ? (parsed as MigrationConfig[]) : [parsed as MigrationConfig];
}

/**
 * Validate every phase config, collecting all errors across all phases.
 * Returns an empty array when every phase is valid.
 */
function validateAllPhases(configs: MigrationConfig[]): string[] {
  const errors: string[] = [];
  configs.forEach((cfg, i) => {
    const { errors: phaseErrors } = validateMigrationConfig(cfg);
    for (const e of phaseErrors) {
      errors.push(configs.length > 1 ? `phase ${(i + 1).toString()}: ${e}` : e);
    }
  });
  return errors;
}

export function registerMigrationCommands(program: Command): void {
  const migration = program
    .command('migration')
    .description('Run schema migrations against a database via a dynamic-secrets lease');

  migration
    .command('apply <config>')
    .description('Apply pending schema migrations for each phase in the given JSON config file')
    .action(async (configPath: string) => {
      try {
        const configs = readConfigFile(configPath);
        const errors = validateAllPhases(configs);
        if (errors.length > 0) {
          output.error(`Invalid migration config in '${configPath}':`);
          for (const e of errors) {
            output.error(`  - ${e}`);
          }
          process.exitCode = 1;
          return;
        }

        const ctx = {
          output: {
            info: (msg: string) => { output.info(msg); },
            warn: (msg: string) => { output.error(msg); },
          },
        };

        for (let i = 0; i < configs.length; i++) {
          const cfg = configs[i];
          const phaseLabel = configs.length > 1 ? ` (phase ${(i + 1).toString()}/${configs.length.toString()})` : '';
          output.info(`Applying migrations from '${cfg.migrationsDir}'${phaseLabel}...`);

          // Only 'mysql' can reach here — validateAllPhases already rejected 'postgres'.
          const deps = defaultDeps(client, mysqlAdapter);
          await runMigrations(
            ctx,
            {
              engine: cfg.engine,
              env: configPath,
              roleId: cfg.roleId,
              migrationsDir: cfg.migrationsDir,
              database: cfg.database,
              scaffoldingFile: cfg.scaffoldingFile,
            },
            deps,
          );
        }

        output.success('Migrations applied successfully.');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  migration
    .command('status <config>')
    .description('Show pending/applied/reconcile migration counts for each phase (read-only)')
    .action(async (configPath: string) => {
      try {
        const configs = readConfigFile(configPath);
        const errors = validateAllPhases(configs);
        if (errors.length > 0) {
          output.error(`Invalid migration config in '${configPath}':`);
          for (const e of errors) {
            output.error(`  - ${e}`);
          }
          process.exitCode = 1;
          return;
        }

        const rows: Array<Array<string | number>> = [];

        for (let i = 0; i < configs.length; i++) {
          const cfg = configs[i];
          const phaseLabel = configs.length > 1 ? `phase ${(i + 1).toString()}` : cfg.migrationsDir;
          const status = await getPhaseStatus(cfg);
          rows.push([phaseLabel, status.applied, status.reconcile, status.pending]);
        }

        output.table(['Phase', 'Applied', 'Reconcile', 'Pending'], rows);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

/**
 * Mint a short-lived lease, open a connection, compute status, and ALWAYS
 * revoke the lease (try/finally) — even if opening the connection or reading
 * status throws.
 *
 * This mirrors the lease-mint/revoke shape used elsewhere in the CLI (see
 * `src/commands/mysql/broker.ts`) and by the package's own `runMigrations`,
 * but only mints/opens/reads/revokes — it never calls `runner.run()`.
 */
async function getPhaseStatus(
  cfg: MigrationConfig,
): Promise<{ applied: number; reconcile: number; pending: number }> {
  // Only 'mysql' can reach here — validateAllPhases already rejected 'postgres'.
  const credential = await client.post<StatusLeaseCredential>(
    `/v1/dynamic-secrets/roles/${cfg.roleId}/credentials`,
    { ttlSeconds: STATUS_LEASE_TTL_SECONDS },
  );

  let revoked = false;
  const revoke = async (): Promise<void> => {
    if (revoked) return;
    revoked = true;
    try {
      await client.post(`/v1/dynamic-secrets/leases/${credential.leaseId}/revoke`, {
        reason: 'znvault-migration-status-cleanup',
      });
    } catch (err) {
      output.error(
        `WARN: failed to revoke lease ${credential.leaseId}: ${err instanceof Error ? err.message : String(err)}. ` +
        `It will expire at its TTL.`,
      );
    }
  };

  try {
    if (!credential.host || credential.port === undefined) {
      throw new Error(
        `Vault did not return host/port in the credential for role '${cfg.roleId}'. ` +
        `Please upgrade vault to a version that returns host/port in dynamic-secret credentials.`,
      );
    }

    const database = credential.database ?? cfg.database;
    if (!database) {
      throw new Error(
        `No database name: the Vault dynamic-secrets connection for role '${cfg.roleId}' did not return a ` +
        `database name and no database override was provided in the migration config.`,
      );
    }

    const conn = await mysqlAdapter.openConnection({
      host: credential.host,
      port: credential.port,
      database,
      user: credential.username,
      password: credential.password,
      ssl: true,
    });

    try {
      const appliedBy = `${os.userInfo().username}@${os.hostname()}`;
      const scaffolding = cfg.scaffoldingFile
        ? { filename: cfg.scaffoldingFile, leaseUser: credential.username }
        : undefined;
      const runner = new MigrationRunner(mysqlAdapter, conn, cfg.migrationsDir, appliedBy, [], scaffolding);
      return await runner.status();
    } finally {
      await conn.end().catch(() => {
        // best-effort; never mask the primary result/error
      });
    }
  } finally {
    await revoke();
  }
}
