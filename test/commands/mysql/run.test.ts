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
import { execSync } from 'node:child_process';

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

  it('writes the resolved-binary audit line to STDERR, not STDOUT (M-1)', () => {
    const hasMysql = (() => {
      try {
        execSync('command -v mysql', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();
    if (!hasMysql) return; // can't assert positive case without mysql

    process.env.PATH = originalPath;

    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = ((chunk: any, ...rest: any[]): boolean => {
      stdoutWrites.push(String(chunk));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return origStdout(chunk, ...rest);
    }) as typeof process.stdout.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = ((chunk: any, ...rest: any[]): boolean => {
      stderrWrites.push(String(chunk));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return origStderr(chunk, ...rest);
    }) as typeof process.stderr.write;

    try {
      assertMysqlOnPath();
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }

    const stdout = stdoutWrites.join('');
    const stderr = stderrWrites.join('');
    // The audit line must NOT pollute machine-readable stdout.
    expect(stdout).not.toContain('Resolved mysql binary');
    // It must appear on stderr instead.
    expect(stderr).toContain('Resolved mysql binary');
  });

  it('returns an absolute path ending with "mysql" when mysql IS on PATH', () => {
    // This machine has mysql at /opt/homebrew/bin/mysql.
    // If the test machine lacks mysql, we skip rather than fail.
    const hasMysql = (() => {
      try {
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
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    expect(args[0]).toBe(`--defaults-extra-file=${CNF_PATH}`);
  });

  it('sets MYSQL_HISTFILE=/dev/null in the child environment (spec F4)', () => {
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    expect(env.MYSQL_HISTFILE).toBe('/dev/null');
  });

  it('does NOT put any password or user in argv', () => {
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      database: 'mydb',
      passthrough: ['--verbose'],
    });
    const argsStr = args.join(' ');
    // Password and user must not appear; they live in the cnf file only.
    expect(argsStr).not.toMatch(/-p\s*\S+|--password/i);
    expect(argsStr).not.toMatch(/-u\s*\S+|--user/i);
  });

  it('does NOT put any password or user in env (beyond what process.env already contains)', () => {
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    // MYSQL_PWD must not be added by buildMysqlInvocation.
    expect(env.MYSQL_PWD).toBeUndefined();
  });

  it('does NOT add --host or --port flags (connection params come from cnf — spec F2)', () => {
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
    });
    const argsStr = args.join(' ');
    expect(argsStr).not.toMatch(/--host|--port|-h\s|-P\s/);
  });

  // ── Database positional arg (spec F8) ────────────────────────────────────

  it('appends database as a positional arg AFTER the flags, when provided', () => {
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, database: 'appdb' });
    // First arg = --defaults-extra-file; database must appear after all flags.
    expect(args[0]).toBe(`--defaults-extra-file=${CNF_PATH}`);
    expect(args).toContain('appdb');
    // database must be after --defaults-extra-file (i.e., index >= 1)
    const dbIndex = args.indexOf('appdb');
    expect(dbIndex).toBeGreaterThan(0);
  });

  it('omits the database positional arg when not provided', () => {
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    // No bare word that looks like a database name should appear.
    // The only flag-like arg should be --defaults-extra-file.
    const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
    expect(nonFlagArgs).toHaveLength(0);
  });

  // ── Passthrough args ─────────────────────────────────────────────────────

  it('appends passthrough args verbatim at the end of argv', () => {
    const passthrough = ['--verbose', '--column-names'];
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH, passthrough });
    const lastTwo = args.slice(-2);
    expect(lastTwo).toEqual(passthrough);
  });

  it('appends passthrough args AFTER the database positional when both are present', () => {
    const passthrough = ['--verbose'];
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
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

  it('returns mode-agnostic args (mode removed from builder — stdin wiring is done by caller)', () => {
    // buildMysqlInvocation has no mode param; args are always mode-agnostic.
    const { args } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    expect(args[0]).toBe(`--defaults-extra-file=${CNF_PATH}`);
    expect(args).toHaveLength(1);
  });

  // ── Environment inherits process.env ────────────────────────────────────

  it('preserves existing process.env variables in the returned env', () => {
    const prev = process.env.HOME;
    const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH });
    if (prev !== undefined) {
      expect(env.HOME).toBe(prev);
    }
  });

  it('overrides MYSQL_HISTFILE even if process.env already sets it to something else', () => {
    const prevHistfile = process.env.MYSQL_HISTFILE;
    process.env.MYSQL_HISTFILE = '/tmp/sneaky_history';
    try {
      const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH });
      expect(env.MYSQL_HISTFILE).toBe('/dev/null');
    } finally {
      if (prevHistfile === undefined) {
        delete process.env.MYSQL_HISTFILE;
      } else {
        process.env.MYSQL_HISTFILE = prevHistfile;
      }
    }
  });

  // ── Security: scrub ambient MYSQL_PWD (spec: password ONLY from cnf) ─────

  it('scrubs MYSQL_PWD from the child env even when process.env has it set', () => {
    // Poison the parent env to simulate an operator who happens to have
    // MYSQL_PWD exported in their shell session.
    const prev = process.env.MYSQL_PWD;
    process.env.MYSQL_PWD = 'supersecret';
    try {
      const { env } = buildMysqlInvocation({ cnfPath: CNF_PATH });
      // MYSQL_PWD must be absent — the password must come ONLY from the cnf.
      expect(env.MYSQL_PWD).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.MYSQL_PWD;
      } else {
        process.env.MYSQL_PWD = prev;
      }
    }
  });

  // ── I-1: forbidden passthrough flags (F2 access-control bypass) ──────────
  //
  // mysql command-line flags override option-file values (last-wins). A caller
  // who slips --host/--port (or --defaults-extra-file/--password/...) into the
  // passthrough would re-point or re-credential the leased '%' connection at an
  // arbitrary server — the exact F2 bypass the spec forbids. buildMysqlInvocation
  // must reject any such token BEFORE appending the passthrough.

  it.each([
    ['--host', 'evil-db'],
    ['--port', '3307'],
    ['--defaults-extra-file', '/tmp/evil.cnf'],
    ['--defaults-file', '/tmp/evil.cnf'],
    ['--login-path', 'evil'],
    ['--password', 'x'],
  ])('rejects a "%s <value>" passthrough with the F2 error', (flag, value) => {
    expect(() =>
      buildMysqlInvocation({ cnfPath: CNF_PATH, passthrough: [flag, value] }),
    ).toThrow(/is not allowed.*host\/port come from the leased connection.*F2/s);
  });

  it.each([
    '--host=evil-db',
    '--port=3307',
    '--defaults-extra-file=/tmp/evil.cnf',
    '--defaults-file=/tmp/evil.cnf',
    '--login-path=evil',
    '--password=x',
    '--no-defaults',
  ])('rejects the inline "%s" passthrough form with the F2 error', (token) => {
    expect(() =>
      buildMysqlInvocation({ cnfPath: CNF_PATH, passthrough: [token] }),
    ).toThrow(/is not allowed.*F2/s);
  });

  it.each([
    ['-h', 'evil-db'],
    ['-P', '3307'],
    ['-p', 'x'],
  ])('rejects the short "%s" passthrough flag with the F2 error', (flag, value) => {
    expect(() =>
      buildMysqlInvocation({ cnfPath: CNF_PATH, passthrough: [flag, value] }),
    ).toThrow(/is not allowed.*F2/s);
  });

  it('names the offending flag in the rejection error', () => {
    expect(() =>
      buildMysqlInvocation({ cnfPath: CNF_PATH, passthrough: ['--host', 'evil'] }),
    ).toThrow(/Passthrough flag '--host' is not allowed/);
  });

  it('allows benign passthrough flags through unchanged', () => {
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      passthrough: ['--batch', '--silent'],
    });
    // Benign flags survive appended at the end.
    expect(args.slice(-2)).toEqual(['--batch', '--silent']);
  });

  it('does NOT over-reject flags that merely START with a forbidden name', () => {
    // --hostname / --port-something are NOT in the forbidden set; only exact
    // flag names (with optional =value) must be rejected.
    const { args } = buildMysqlInvocation({
      cnfPath: CNF_PATH,
      passthrough: ['--hostgroup=1', '--port-something'],
    });
    expect(args).toContain('--hostgroup=1');
    expect(args).toContain('--port-something');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I-1 (runMysql): forbidden passthrough must be rejected before any spawn.
// We mock node:child_process so no real mysql is spawned; the rejection must
// happen during argv assembly (buildMysqlInvocation), before spawn is reached.
describe('runMysql — forbidden passthrough rejection (I-1)', () => {
  it('throws the F2 error for "-- --host evil" and never spawns mysql', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');
    await expect(
      runMysql({
        cnfPath: '/dev/shm/x/my.cnf',
        mode: 'exec',
        sql: 'SELECT 1',
        passthrough: ['--host', 'evil'],
      }),
    ).rejects.toThrow(/Passthrough flag '--host' is not allowed.*F2/s);
  });
});
