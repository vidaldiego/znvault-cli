// Path: test/commands/migration.test.ts

/**
 * Tests for `znvault migration apply` / `znvault migration status`.
 *
 * `@zincapp/znvault-migrate` is mocked so these tests verify the COMMAND
 * WIRING (config read/validate, dispatch into the package's public API) —
 * not real MySQL connectivity, which is exercised by the package's own
 * real-DB e2e suite (Phase 1/2 of the migration-lib project).
 *
 * `validateMigrationConfig` is a faithful re-implementation of the real
 * package rule (engine required; 'postgres' → the §5 deferred-adapter error)
 * so the postgres-rejection test exercises the actual error string a caller
 * would see.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POSTGRES_DEFERRED_ERROR =
  'postgres migrations are not yet supported (the PostgreSQL adapter is a deferred project — see the znvault-migrate PostgreSQL design)';

// ── Mock @zincapp/znvault-migrate ──────────────────────────────────────────
const runMigrationsMock = vi.fn().mockResolvedValue(undefined);
const statusMock = vi.fn().mockResolvedValue({ applied: 1, reconcile: 0, pending: 2 });
const openConnectionMock = vi.fn().mockResolvedValue({
  query: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
});

vi.mock('@zincapp/znvault-migrate', () => ({
  runMigrations: (...args: unknown[]) => runMigrationsMock(...args),
  defaultDeps: vi.fn(() => ({})),
  mysqlAdapter: {
    engine: 'mysql',
    openConnection: (...args: unknown[]) => openConnectionMock(...args),
  },
  MigrationRunner: vi.fn().mockImplementation(function MockMigrationRunner(this: { status: typeof statusMock }) {
    this.status = statusMock;
  }),
  validateMigrationConfig: (cfg: { engine?: string; roleId?: string; migrationsDir?: string }) => {
    const errors: string[] = [];
    if (cfg.engine !== 'mysql' && cfg.engine !== 'postgres') {
      errors.push("engine is required and must be 'mysql' or 'postgres'.");
    } else if (cfg.engine === 'postgres') {
      errors.push(POSTGRES_DEFERRED_ERROR);
    }
    if (!cfg.roleId) errors.push('roleId is required (the dynamic-secrets write role).');
    if (!cfg.migrationsDir) errors.push('migrationsDir is required.');
    return { errors };
  },
}));

// ── Mock the CLI's authenticated client ────────────────────────────────────
const postMock = vi.fn();
vi.mock('../../src/lib/client.js', () => ({
  client: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

// ── Mock output ─────────────────────────────────────────────────────────────
const outputCalls: { info: string[]; error: string[]; success: string[]; tables: Array<[string[], unknown[][]]> } = {
  info: [],
  error: [],
  success: [],
  tables: [],
};
vi.mock('../../src/lib/output.js', () => ({
  info: vi.fn((msg: string) => { outputCalls.info.push(msg); }),
  error: vi.fn((msg: string) => { outputCalls.error.push(msg); }),
  success: vi.fn((msg: string) => { outputCalls.success.push(msg); }),
  table: vi.fn((headers: string[], rows: unknown[][]) => { outputCalls.tables.push([headers, rows]); }),
}));

import { registerMigrationCommands } from '../../src/commands/migration.js';

function makeProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerMigrationCommands(p);
  return p;
}

describe('migration commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outputCalls.info = [];
    outputCalls.error = [];
    outputCalls.success = [];
    outputCalls.tables = [];
    tmpDir = mkdtempSync(join(tmpdir(), 'znvault-migration-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(name: string, content: unknown): string {
    const p = join(tmpDir, name);
    writeFileSync(p, JSON.stringify(content), 'utf8');
    return p;
  }

  describe('apply', () => {
    it('drives runMigrations for a single mysql phase', async () => {
      const configPath = writeConfig('mysql-config.json', {
        engine: 'mysql',
        roleId: 'dbr_abc123',
        migrationsDir: '/abs/path/migrations',
      });

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'apply', configPath]);

      expect(runMigrationsMock).toHaveBeenCalledTimes(1);
      const [, opts] = runMigrationsMock.mock.calls[0] as [unknown, Record<string, unknown>, unknown];
      expect(opts).toMatchObject({
        engine: 'mysql',
        roleId: 'dbr_abc123',
        migrationsDir: '/abs/path/migrations',
      });
      expect(outputCalls.success.length).toBeGreaterThan(0);
      expect(outputCalls.error).toHaveLength(0);
    });

    it('drives runMigrations once per phase for an array config', async () => {
      const configPath = writeConfig('multi-phase.json', [
        { engine: 'mysql', roleId: 'dbr_pre', migrationsDir: '/abs/pre' },
        { engine: 'mysql', roleId: 'dbr_post', migrationsDir: '/abs/post' },
      ]);

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'apply', configPath]);

      expect(runMigrationsMock).toHaveBeenCalledTimes(2);
      const firstOpts = runMigrationsMock.mock.calls[0][1] as Record<string, unknown>;
      const secondOpts = runMigrationsMock.mock.calls[1][1] as Record<string, unknown>;
      expect(firstOpts).toMatchObject({ roleId: 'dbr_pre', migrationsDir: '/abs/pre' });
      expect(secondOpts).toMatchObject({ roleId: 'dbr_post', migrationsDir: '/abs/post' });
    });

    it('rejects a postgres config with the §5 deferred error and never calls runMigrations', async () => {
      const configPath = writeConfig('pg-config.json', {
        engine: 'postgres',
        roleId: 'dbr_pg',
        migrationsDir: '/abs/pg-migrations',
      });

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'apply', configPath]);

      expect(runMigrationsMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const joined = outputCalls.error.join('\n');
      expect(joined).toContain(POSTGRES_DEFERRED_ERROR);

      process.exitCode = 0; // reset for subsequent tests
    });

    it('errors clearly when the config file does not exist', async () => {
      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'apply', join(tmpDir, 'missing.json')]);

      expect(runMigrationsMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });

    it('errors clearly on invalid JSON', async () => {
      const p = join(tmpDir, 'bad.json');
      writeFileSync(p, '{ not valid json', 'utf8');

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'apply', p]);

      expect(runMigrationsMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });
  });

  describe('status', () => {
    it('mints a lease, opens a connection, prints counts, and revokes the lease', async () => {
      postMock.mockImplementation((path: string) => {
        if (path.includes('/credentials')) {
          return Promise.resolve({
            leaseId: 'lease-1',
            username: 'ephemeral-user',
            password: 'secret',
            host: 'db.internal',
            port: 3306,
            database: 'appdb',
          });
        }
        if (path.includes('/revoke')) {
          return Promise.resolve({});
        }
        throw new Error(`unexpected path: ${path}`);
      });

      const configPath = writeConfig('status-config.json', {
        engine: 'mysql',
        roleId: 'dbr_abc123',
        migrationsDir: '/abs/path/migrations',
      });

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'status', configPath]);

      // Lease minted then revoked.
      expect(postMock).toHaveBeenCalledWith(
        '/v1/dynamic-secrets/roles/dbr_abc123/credentials',
        expect.objectContaining({ ttlSeconds: expect.any(Number) }),
      );
      expect(postMock).toHaveBeenCalledWith(
        '/v1/dynamic-secrets/leases/lease-1/revoke',
        expect.objectContaining({ reason: expect.any(String) }),
      );

      // Connection opened + status read.
      expect(openConnectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'db.internal', port: 3306, database: 'appdb' }),
      );
      expect(statusMock).toHaveBeenCalledTimes(1);

      // Counts printed via output.table.
      expect(outputCalls.tables).toHaveLength(1);
      const [headers, rows] = outputCalls.tables[0];
      expect(headers).toEqual(['Phase', 'Applied', 'Reconcile', 'Pending']);
      expect(rows[0]).toEqual(['/abs/path/migrations', 1, 0, 2]);
    });

    it('always revokes the lease even when opening the connection fails', async () => {
      openConnectionMock.mockRejectedValueOnce(new Error('connection refused'));
      postMock.mockImplementation((path: string) => {
        if (path.includes('/credentials')) {
          return Promise.resolve({
            leaseId: 'lease-2',
            username: 'ephemeral-user',
            password: 'secret',
            host: 'db.internal',
            port: 3306,
            database: 'appdb',
          });
        }
        if (path.includes('/revoke')) {
          return Promise.resolve({});
        }
        throw new Error(`unexpected path: ${path}`);
      });

      const configPath = writeConfig('status-config-fail.json', {
        engine: 'mysql',
        roleId: 'dbr_abc123',
        migrationsDir: '/abs/path/migrations',
      });

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'status', configPath]);

      expect(postMock).toHaveBeenCalledWith(
        '/v1/dynamic-secrets/leases/lease-2/revoke',
        expect.objectContaining({ reason: expect.any(String) }),
      );
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });

    it('rejects a postgres config before minting any lease', async () => {
      const configPath = writeConfig('status-pg-config.json', {
        engine: 'postgres',
        roleId: 'dbr_pg',
        migrationsDir: '/abs/pg-migrations',
      });

      const program = makeProgram();
      await program.parseAsync(['node', 'znvault', 'migration', 'status', configPath]);

      expect(postMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const joined = outputCalls.error.join('\n');
      expect(joined).toContain(POSTGRES_DEFERRED_ERROR);
      process.exitCode = 0;
    });
  });
});
