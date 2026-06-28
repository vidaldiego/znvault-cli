// test/commands/mysql/run.test.ts

/**
 * Tests for assertMysqlOnPath and buildMysqlInvocation (run.ts).
 *
 * Testing strategy:
 *   - assertMysqlOnPath: unit-testable by manipulating process.env.PATH.
 *   - buildMysqlInvocation: pure helper; tested for security-critical argv/env
 *     invariants (--defaults-extra-file is args[0], MYSQL_HISTFILE=/dev/null in
 *     env, no password/user in args or env) without spawning real mysql.
 *   - runMysql: not unit-tested here (spawning real mysql is heavy); covered by
 *     the security-critical properties via buildMysqlInvocation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';

// We import lazily inside tests so PATH manipulation takes effect before the
// module resolves the binary path. But since assertMysqlOnPath is called at
// invocation time (not module-load time), top-level import is fine.
import {
  assertMysqlOnPath,
  buildMysqlInvocation,
} from '../../../src/commands/mysql/run.js';

// ─────────────────────────────────────────────────────────────────────────────
describe('assertMysqlOnPath', () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    // Restore PATH no matter what.
    process.env.PATH = originalPath;
  });

  it('throws a clear, actionable error when mysql is absent from PATH', () => {
    process.env.PATH = '/nonexistent';
    expect(() => assertMysqlOnPath()).toThrow(/mysql.*not found|install/i);
  });

  it('includes installation hints in the thrown error', () => {
    process.env.PATH = '/nonexistent';
    let caught: unknown;
    try {
      assertMysqlOnPath();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    // Should mention mysql and installation options
    expect(msg.toLowerCase()).toContain('mysql');
    expect(msg).toMatch(/brew|apt|install/i);
  });

  it('returns an absolute path ending with "mysql" when mysql IS on PATH', () => {
    // This machine has mysql at /opt/homebrew/bin/mysql.
    // If the test machine lacks mysql, we skip rather than fail.
    const hasMysql = (() => {
      try {
        const { execSync } = require('child_process') as typeof import('child_process');
        execSync('command -v mysql', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (!hasMysql) {
      // Skip: mysql not installed on this machine; can't assert positive case.
      return;
    }

    // Restore PATH to system PATH for this assertion.
    process.env.PATH = originalPath;
    const resolved = assertMysqlOnPath();
    expect(typeof resolved).toBe('string');
    expect(resolved.length).toBeGreaterThan(0);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(path.basename(resolved)).toBe('mysql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildMysqlInvocation', () => {
  const CNF_PATH = '/dev/shm/znvault-test-abc123/my.cnf';

  // ── Security-critical: flag order and secrets ────────────────────────────

  it('puts --defaults-extra-file=<cnfPath> as the FIRST argument', () => {
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    expect(args[0]).toBe(`--defaults-extra-file=${CNF_PATH}`);
  });

  it('sets MYSQL_HISTFILE=/dev/null in the child environment (spec F4)', () => {
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    expect(env.MYSQL_HISTFILE).toBe('/dev/null');
  });

  it('does NOT put any password or user in argv', () => {
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      mode: 'connect',
      database: 'mydb',
      passthrough: ['--verbose'],
    });
    const argsStr = args.join(' ');
    // Password and user must not appear; they live in the cnf file only.
    expect(argsStr).not.toMatch(/-p\s*\S+|--password/i);
    expect(argsStr).not.toMatch(/-u\s*\S+|--user/i);
  });

  it('does NOT put any password or user in env (beyond what process.env already contains)', () => {
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    // MYSQL_PWD must not be added by buildMysqlInvocation.
    expect(env.MYSQL_PWD).toBeUndefined();
  });

  it('does NOT add --host or --port flags (connection params come from cnf — spec F2)', () => {
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      mode: 'connect',
    });
    const argsStr = args.join(' ');
    expect(argsStr).not.toMatch(/--host|--port|-h\s|-P\s/);
  });

  // ── Database positional arg (spec F8) ────────────────────────────────────

  it('appends database as a positional arg AFTER the flags, when provided', () => {
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect', database: 'appdb' });
    // First arg = --defaults-extra-file; database must appear after all flags.
    expect(args[0]).toBe(`--defaults-extra-file=${CNF_PATH}`);
    expect(args).toContain('appdb');
    // database must be after --defaults-extra-file (i.e., index >= 1)
    const dbIndex = args.indexOf('appdb');
    expect(dbIndex).toBeGreaterThan(0);
  });

  it('omits the database positional arg when not provided', () => {
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    // No bare word that looks like a database name should appear.
    // The only flag-like arg should be --defaults-extra-file.
    const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
    expect(nonFlagArgs).toHaveLength(0);
  });

  // ── Passthrough args ─────────────────────────────────────────────────────

  it('appends passthrough args verbatim at the end of argv', () => {
    const passthrough = ['--verbose', '--column-names'];
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect', passthrough });
    const lastTwo = args.slice(-2);
    expect(lastTwo).toEqual(passthrough);
  });

  it('appends passthrough args AFTER the database positional when both are present', () => {
    const passthrough = ['--verbose'];
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      mode: 'connect',
      database: 'appdb',
      passthrough,
    });
    const dbIndex = args.indexOf('appdb');
    const vtIndex = args.indexOf('--verbose');
    expect(dbIndex).toBeGreaterThan(0);
    expect(vtIndex).toBeGreaterThan(dbIndex);
  });

  // ── exec-specific: no --batch/--skip-column-names forced from builder ────
  // (exec mode stdin wiring is handled by runMysql, not buildMysqlInvocation)

  it('returns the same base args for exec mode as for connect mode', () => {
    const connect = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    const exec = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'exec' });
    // Core args should be identical (stdin wiring is done by the caller).
    expect(exec.args).toEqual(connect.args);
  });

  // ── Environment inherits process.env ────────────────────────────────────

  it('preserves existing process.env variables in the returned env', () => {
    const prev = process.env.HOME;
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
    if (prev !== undefined) {
      expect(env.HOME).toBe(prev);
    }
  });

  it('overrides MYSQL_HISTFILE even if process.env already sets it to something else', () => {
    const prevHistfile = process.env.MYSQL_HISTFILE;
    process.env.MYSQL_HISTFILE = '/tmp/sneaky_history';
    try {
      const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH, mode: 'connect' });
      expect(env.MYSQL_HISTFILE).toBe('/dev/null');
    } finally {
      if (prevHistfile === undefined) {
        delete process.env.MYSQL_HISTFILE;
      } else {
        process.env.MYSQL_HISTFILE = prevHistfile;
      }
    }
  });
});
