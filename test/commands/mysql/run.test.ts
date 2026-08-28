// test/commands/mysql/run.test.ts

/**
 * Tests for assertMysqlOnPath and buildMysqlInvocation (run.ts).
 *
 * Testing strategy:
 *   - assertMysqlOnPath: unit-testable by manipulating process.env.PATH.
 *   - buildMysqlInvocation: pure helper; tested for security-critical argv/env
 *     invariants (--defaults-file is args[0], --no-login-paths is args[1],
 *     MYSQL_HISTFILE=/dev/null in
 *     env, no password/user in args or env) without spawning real mysql.
 *   - runMysql: not unit-tested here (spawning real mysql is heavy); covered by
 *     the security-critical properties via buildMysqlInvocation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

// We import lazily inside tests so PATH manipulation takes effect before the
// module resolves the binary path. But since assertMysqlOnPath is called at
// invocation time (not module-load time), top-level import is fine.
import {
  assertMysqlExecCapabilities,
  assertMysqlOnPath,
  assertSafeMysqlDatabase,
  buildMysqlInvocation,
  buildChildStdio,
  inspectMysqlClient,
  runMysql,
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

describe('inspectMysqlClient', () => {
  function fakeClient(help: string): {binary: string; cleanup: () => void} {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znv-mysql-capability-'));
    const binary = path.join(dir, 'mysql');
    fs.writeFileSync(
      binary,
      `#!/bin/sh
cat <<'HELP'
${help}
HELP
`,
      {mode: 0o700},
    );
    return {
      binary,
      cleanup: () => { fs.rmSync(dir, {recursive: true, force: true}); },
    };
  }

  it('keeps --no-login-paths for an Oracle MySQL client', () => {
    const fixture = fakeClient(
      'mysql  Ver 8.4\n  --defaults-file=#\n  --no-login-paths\n  --binary-mode',
    );
    try {
      const capabilities = inspectMysqlClient(fixture.binary);
      expect(capabilities).toMatchObject({
        family: 'mysql',
        supportsNoLoginPaths: true,
        supportsBinaryMode: true,
      });
      expect(buildMysqlInvocation({
        fdPath: '/dev/fd/9',
        supportsNoLoginPaths: capabilities.supportsNoLoginPaths,
      }).args.slice(0, 2)).toEqual([
        '--defaults-file=/dev/fd/9',
        '--no-login-paths',
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('uses exclusive --defaults-file without the unsupported flag for MariaDB', () => {
    const fixture = fakeClient(
      'mariadb  Ver 15.1 Distrib 11.4-MariaDB\n  --defaults-file=#\n  --binary-mode',
    );
    try {
      const capabilities = inspectMysqlClient(fixture.binary);
      expect(capabilities).toMatchObject({
        family: 'mariadb',
        supportsNoLoginPaths: false,
        supportsBinaryMode: true,
      });
      expect(buildMysqlInvocation({
        fdPath: '/dev/fd/9',
        supportsNoLoginPaths: capabilities.supportsNoLoginPaths,
        binaryMode: true,
      }).args).toEqual(['--defaults-file=/dev/fd/9', '--binary-mode']);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed for an unknown client that cannot disable login paths', () => {
    const fixture = fakeClient('mysql-compatible\n  --defaults-file=#');
    try {
      expect(() => inspectMysqlClient(fixture.binary)).toThrow(/cannot disable login paths/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed for piped SQL when the selected client lacks binary mode', () => {
    const fixture = fakeClient(
      'mysql  Ver 8.4\n  --defaults-file=#\n  --no-login-paths',
    );
    try {
      const capabilities = inspectMysqlClient(fixture.binary);
      expect(capabilities.supportsBinaryMode).toBe(false);
      expect(() => assertMysqlExecCapabilities(capabilities)).toThrow(
        /cannot disable local commands for piped SQL/i,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildMysqlInvocation', () => {
  // The cnf is now passed to mysql as /dev/fd/<fd> (spec F1 — see mycnf.ts).
  const CNF_PATH = '/dev/fd/11';

  // ── Security-critical: flag order and secrets ────────────────────────────

  it('uses one exclusive defaults file first and disables login paths', () => {
    const { args } = buildMysqlInvocation({ fdPath: CNF_PATH });
    expect(args.slice(0, 2)).toEqual([
      `--defaults-file=${CNF_PATH}`,
      '--no-login-paths',
    ]);
    expect(args.join(' ')).not.toContain('--defaults-extra-file');
  });

  it('forces binary mode for non-interactive SQL before the positional schema', () => {
    const {args} = buildMysqlInvocation({
      fdPath: CNF_PATH,
      database: 'appdb',
      binaryMode: true,
    });
    expect(args).toEqual([
      `--defaults-file=${CNF_PATH}`,
      '--no-login-paths',
      '--binary-mode',
      '--',
      'appdb',
    ]);
  });

  it('sets MYSQL_HISTFILE=/dev/null in the child environment (spec F4)', () => {
    const { env } = buildMysqlInvocation({ fdPath: CNF_PATH });
    expect(env.MYSQL_HISTFILE).toBe('/dev/null');
  });

  it('does NOT put any password or user in argv', () => {
    const { args } = buildMysqlInvocation({
      fdPath: CNF_PATH,
      database: 'mydb',
      passthrough: ['--verbose'],
    });
    // Password and user must not appear; they live in the cnf file only.
    expect(args.some(arg => arg === '-p' || arg.startsWith('--password'))).toBe(false);
    expect(args.some(arg => arg === '-u' || arg.startsWith('--user'))).toBe(false);
  });

  it('does NOT put any password or user in env (beyond what process.env already contains)', () => {
    const { env } = buildMysqlInvocation({ fdPath: CNF_PATH });
    // MYSQL_PWD must not be added by buildMysqlInvocation.
    expect(env.MYSQL_PWD).toBeUndefined();
  });

  it('does NOT add --host or --port flags (connection params come from cnf — spec F2)', () => {
    const { args } = buildMysqlInvocation({
      fdPath: CNF_PATH,
    });
    const argsStr = args.join(' ');
    expect(argsStr).not.toMatch(/--host|--port|-h\s|-P\s/);
  });

  // ── Database positional arg (spec F8) ────────────────────────────────────

  it('appends database as a positional arg AFTER the flags, when provided', () => {
    const { args } = buildMysqlInvocation({ fdPath: CNF_PATH, database: 'appdb' });
    // Defaults isolation flags precede the positional database.
    expect(args.slice(0, 2)).toEqual([
      `--defaults-file=${CNF_PATH}`,
      '--no-login-paths',
    ]);
    expect(args).toContain('appdb');
    // database must be after both defaults-isolation flags and `--`.
    const dbIndex = args.indexOf('appdb');
    expect(dbIndex).toBeGreaterThan(1);
    expect(args[dbIndex - 1]).toBe('--');
  });

  it('omits the database positional arg when not provided', () => {
    const { args } = buildMysqlInvocation({ fdPath: CNF_PATH });
    // No bare word that looks like a database name should appear.
    // Only the two defaults-isolation options are present.
    const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
    expect(nonFlagArgs).toHaveLength(0);
  });

  // ── Passthrough args ─────────────────────────────────────────────────────

  it('appends passthrough args verbatim at the end of argv', () => {
    const passthrough = ['--verbose', '--column-names'];
    const { args } = buildMysqlInvocation({ fdPath: CNF_PATH, passthrough });
    const lastTwo = args.slice(-2);
    expect(lastTwo).toEqual(passthrough);
  });

  it('places passthrough before -- and the database positional after it', () => {
    const passthrough = ['--verbose'];
    const { args } = buildMysqlInvocation({
      fdPath: CNF_PATH,
      database: 'appdb',
      passthrough,
    });
    const dbIndex = args.indexOf('appdb');
    const vtIndex = args.indexOf('--verbose');
    const terminatorIndex = args.indexOf('--');
    expect(vtIndex).toBeGreaterThan(0);
    expect(vtIndex).toBeLessThan(terminatorIndex);
    expect(dbIndex).toBe(terminatorIndex + 1);
  });

  it.each([
    '',
    '--print-defaults',
    '--enable-skip-binary-mode',
    '-eSELECT 1',
    'name with spaces',
    '../mysql',
    'éxample',
    'a'.repeat(65),
  ])('rejects unsafe database/schema value %j', (database) => {
    expect(() => assertSafeMysqlDatabase(database)).toThrow(
      /Invalid MySQL database\/schema/,
    );
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      database,
    })).toThrow(/Invalid MySQL database\/schema/);
  });

  it.each([
    'appdb',
    'packleader_v1',
    'tenant-42',
    '$internal',
    'schema.with.dot',
  ])('accepts safe database/schema value %s', (database) => {
    expect(() => assertSafeMysqlDatabase(database)).not.toThrow();
  });

  // ── exec-specific: no --batch/--skip-column-names forced from builder ────
  // (exec mode stdin wiring is handled by runMysql, not buildMysqlInvocation)

  it('returns mode-agnostic args (mode removed from builder — stdin wiring is done by caller)', () => {
    // buildMysqlInvocation has no mode param; args are always mode-agnostic.
    const { args } = buildMysqlInvocation({ fdPath: CNF_PATH });
    expect(args).toEqual([
      `--defaults-file=${CNF_PATH}`,
      '--no-login-paths',
    ]);
  });

  // ── Minimal non-secret child environment ────────────────────────────────

  it('allowlists runtime basics but never inherits Vault or arbitrary secrets', () => {
    const names = [
      'PATH',
      'LANG',
      'LC_ALL',
      'LC_RECOVERY_SECRET',
      'HOME',
      'ZNVAULT_API_KEY',
      'ZNVAULT_PASSWORD',
      'UNRELATED_DEPLOY_SECRET',
    ] as const;
    const previous = new Map(names.map(name => [name, process.env[name]]));
    process.env.PATH = '/usr/bin:/bin';
    process.env.LANG = 'C.UTF-8';
    process.env.LC_ALL = 'C';
    process.env.LC_RECOVERY_SECRET = 'synthetic-locale-prefix-canary';
    process.env.HOME = '/tmp/ambient-home';
    process.env.ZNVAULT_API_KEY = 'synthetic-api-key-canary';
    process.env.ZNVAULT_PASSWORD = 'synthetic-password-canary';
    process.env.UNRELATED_DEPLOY_SECRET = 'synthetic-unrelated-canary';
    try {
      const {env} = buildMysqlInvocation({fdPath: CNF_PATH});
      expect(env.PATH).toBe('/usr/bin:/bin');
      expect(env.LANG).toBe('C.UTF-8');
      expect(env.LC_ALL).toBe('C');
      expect(env.LC_RECOVERY_SECRET).toBeUndefined();
      expect(env.HOME).toBeUndefined();
      expect(env.ZNVAULT_API_KEY).toBeUndefined();
      expect(env.ZNVAULT_PASSWORD).toBeUndefined();
      expect(env.UNRELATED_DEPLOY_SECRET).toBeUndefined();
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('overrides MYSQL_HISTFILE even if process.env already sets it to something else', () => {
    const prevHistfile = process.env.MYSQL_HISTFILE;
    process.env.MYSQL_HISTFILE = '/tmp/sneaky_history';
    try {
      const { env } = buildMysqlInvocation({ fdPath: CNF_PATH });
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
      const { env } = buildMysqlInvocation({ fdPath: CNF_PATH });
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

  it('scrubs ambient MySQL target and option-file selectors', () => {
    const names = [
      'MYSQL_HOST',
      'MYSQL_TCP_PORT',
      'MYSQL_UNIX_PORT',
      'MYSQL_TEST_LOGIN_FILE',
      'MYSQL_HOME',
      'MYSQL_GROUP_SUFFIX',
    ] as const;
    const previous = new Map(names.map(name => [name, process.env[name]]));
    for (const name of names) process.env[name] = 'attacker-controlled';
    try {
      const {env} = buildMysqlInvocation({fdPath: CNF_PATH});
      for (const name of names) expect(env[name]).toBeUndefined();
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
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
    ['--no-login-paths', 'evil'],
    ['--user', 'other'],
    ['--socket', '/tmp/evil.sock'],
    ['--protocol', 'SOCKET'],
    ['--dns-srv-name', 'evil.example'],
    ['--database', 'otherdb'],
    ['--password', 'x'],
  ])('rejects a "%s <value>" passthrough with the F2 error', (flag, value) => {
    expect(() =>
      buildMysqlInvocation({ fdPath: CNF_PATH, passthrough: [flag, value] }),
    ).toThrow(/is not allowed.*host\/port come from the leased connection.*F2/s);
  });

  it.each([
    '--host=evil-db',
    '--port=3307',
    '--defaults-extra-file=/tmp/evil.cnf',
    '--defaults-file=/tmp/evil.cnf',
    '--login-path=evil',
    '--no-login-paths',
    '--user=other',
    '--socket=/tmp/evil.sock',
    '--protocol=SOCKET',
    '--dns-srv-name=evil.example',
    '--database=otherdb',
    '--password=x',
    '--no-defaults',
  ])('rejects the inline "%s" passthrough form with the F2 error', (token) => {
    expect(() =>
      buildMysqlInvocation({ fdPath: CNF_PATH, passthrough: [token] }),
    ).toThrow(/is not allowed.*F2/s);
  });

  it.each([
    '--hos=evil-db',
    '--por=3307',
    '--use=other',
    '--sock=/tmp/evil.sock',
    '--data=otherdb',
    '--pass=x',
    '--defaults_file=/tmp/evil.cnf',
    '--login_path=evil',
    '--dns_srv_name=evil.example',
    '--future-wrapper-host=evil-db',
    '--future-wrapper-def=/tmp/evil.cnf',
  ])('rejects mysql long-option abbreviation or underscore alias "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough: [token],
    })).toThrow(/is not allowed.*F2/s);
  });

  it.each([
    ['-h', 'evil-db'],
    ['-P', '3307'],
    ['-p', 'x'],
    ['-u', 'other'],
    ['-S', '/tmp/evil.sock'],
    ['-D', 'otherdb'],
  ])('rejects the short "%s" passthrough flag with the F2 error', (flag, value) => {
    expect(() =>
      buildMysqlInvocation({ fdPath: CNF_PATH, passthrough: [flag, value] }),
    ).toThrow(/is not allowed.*F2/s);
  });

  it.each([
    '--binary-mode',
    '--skip-binary-mode',
    '--disable-binary-mode',
    '--commands',
    '--skip-commands',
    '--disable-commands',
    '--named-commands',
    '--skip-named-commands',
    '--disable-named-commands',
    '-G',
    '--execute=system whoami',
    '-e',
    '--init-command=system whoami',
    '--init-command-add=system whoami',
    '--loose-skip-binary-mode',
    '--loose-disable-binary-mode',
    '--enable-commands',
    '--loose-enable-named-commands',
    '-eSELECT 1',
    '-GB',
  ])('rejects input-control passthrough "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      binaryMode: true,
      passthrough: [token],
    })).toThrow(/is not allowed.*binary-mode/s);
  });

  it.each([
    '--exec=system whoami',
    '--named_commands',
    '--skip_binary_mode',
    '--loose_skip_binary_mode',
    '--enable_comm',
    '--enable-skip-binary-mode',
    '--loose-enable-skip-binary-mode',
    '--disable-enable-skip-binary-mode',
    '--skip-disable-enable-commands',
    '--enable_skip_binary_mode',
    '--loose_enable_skip_binary_mode',
    '--ena-ski-bin',
    '--loo-ena-ski-bin',
    '--ski-dis-ena-comm',
    '--maximum-binary-mode=0',
    '--loose-maximum-binary-mode=0',
    '--maximum-skip-binary-mode',
    '--maximum_skip_binary_mode',
    '--max-bin=0',
    '--loo-max-ski-bin',
    '--autoset-binary-mode=0',
    '--autoset-skip-binary-mode',
    '--loose-autoset-skip-binary-mode',
    '--autoset_binary_mode=0',
    '--auto-bin=0',
    '--loo-auto-ski-bin',
    '--future-wrapper-skip-binary-mode',
    '--future-wrapper-bin',
    '--future_wrapper_named_commands',
    '--one-two-three-comm',
  ])('rejects input-control long-option abbreviation or underscore alias "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      binaryMode: true,
      passthrough: [token],
    })).toThrow(/is not allowed.*binary-mode/s);
  });

  it.each([
    '--print-defaults',
    '--print_def',
    '--pri',
    '--loose-print-defaults',
    '--enable-skip-print-defaults',
    '--future-wrapper-pri',
  ])('rejects credential-output meta option "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough: [token],
    })).toThrow(/is not allowed.*credentials.*never be printed/s);
  });

  it('fails closed when a modifier chain exceeds the bounded canonicalisation depth', () => {
    const token = `--${'loose-'.repeat(9)}binary-mode`;
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      binaryMode: true,
      passthrough: [token],
    })).toThrow(/is not allowed.*modifier chain exceeds/s);
  });

  it.each([
    '-hevil-db',
    '-P3307',
    '-uother',
    '-S/tmp/evil.sock',
    '-Dotherdb',
    '-ppassword',
    '--loose-host=evil-db',
  ])('rejects attached or loose target/credential passthrough "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough: [token],
    })).toThrow(/is not allowed.*F2/s);
  });

  it.each([
    '-vh127.0.0.1',
    '-vvP3307',
    '-vuleaked',
    '-vS/tmp/evil.sock',
    '-vDotherdb',
    '-vppassword',
  ])('rejects forbidden target/credential options inside short clusters "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough: [token],
    })).toThrow(/is not allowed.*contains -[hPuSDp].*F2/s);
  });

  it.each([
    '-veSELECT 1',
    '-vvG',
  ])('rejects forbidden input-control options inside short clusters "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      binaryMode: true,
      passthrough: [token],
    })).toThrow(/is not allowed.*contains -[eG].*binary-mode/s);
  });

  it('names the offending flag in the rejection error', () => {
    expect(() =>
      buildMysqlInvocation({ fdPath: CNF_PATH, passthrough: ['--host', 'evil'] }),
    ).toThrow(/Passthrough flag '--host' is not allowed/);
  });

  it('allows benign passthrough flags through unchanged', () => {
    const passthrough = [
      '--batch', '--silent', '--raw', '--force', '--table', '--vertical',
      '--verbose', '--column-names',
    ];
    const { args } = buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough,
    });
    expect(args.slice(-passthrough.length)).toEqual(passthrough);
  });

  it.each([
    '-vvv',
    '-BNrs',
    '-fvt',
    '-Aq',
  ])('allows an innocuous short-option cluster unchanged: %s', (token) => {
    const {args} = buildMysqlInvocation({fdPath: CNF_PATH, passthrough: [token]});
    expect(args.at(-1)).toBe(token);
  });

  it.each([
    '--hostgroup=1',
    '--port-something',
    '--help',
    '--version',
    '--pager',
    'unexpected-positional',
  ])('fails closed for unknown or argument-bearing passthrough "%s"', (token) => {
    expect(() => buildMysqlInvocation({
      fdPath: CNF_PATH,
      passthrough: [token],
    })).toThrow(/is not allowed.*only fixed.*argument-free/s);
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
        fd: 11,
        fdPath: '/dev/fd/11',
        mode: 'exec',
        sql: 'SELECT 1',
        passthrough: ['--host', 'evil'],
      }),
    ).rejects.toThrow(/Passthrough flag '--host' is not allowed.*F2/s);
  });

  it.each([
    ['--host', 'evil-db'],
    ['-vh127.0.0.1'],
  ])('rejects %j before mysql PATH resolution', async (...passthrough) => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const {runMysql} = await import('../../../src/commands/mysql/run.js');
      await expect(runMysql({
        fd: 11,
        fdPath: '/dev/fd/11',
        mode: 'exec',
        sql: 'SELECT 1',
        passthrough,
      })).rejects.toThrow(/Passthrough flag.*is not allowed.*F2/s);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('rejects --print-defaults before client resolution with zero stdout', async () => {
    const previousPath = process.env.PATH;
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.PATH = '';
    try {
      await expect(runMysql({
        fd: 11,
        fdPath: '/dev/fd/11',
        mode: 'exec',
        sql: 'SELECT 1',
        passthrough: ['--print-defaults'],
      })).rejects.toThrow(/credentials.*never be printed/s);
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildChildStdio: the cnf fd MUST be inherited by the child at the SAME number
// so --defaults-file=/dev/fd/<fd> resolves inside the child (spec F1).
describe('buildChildStdio', () => {
  it('places the cnf fd at its own numeric index (stdio[fd] === fd)', () => {
    const fd = 17;
    const stdio = buildChildStdio(fd, 'pipe');
    // The defining invariant: index fd inherits the parent fd `fd`.
    expect(stdio[fd]).toBe(fd);
  });

  it('wires stdin per the requested disposition; stdout/stderr always inherit', () => {
    const pipeStdio = buildChildStdio(12, 'pipe');
    expect(pipeStdio[0]).toBe('pipe');
    expect(pipeStdio[1]).toBe('inherit');
    expect(pipeStdio[2]).toBe('inherit');

    const inheritStdio = buildChildStdio(12, 'inherit');
    expect(inheritStdio[0]).toBe('inherit');
    expect(inheritStdio[1]).toBe('inherit');
    expect(inheritStdio[2]).toBe('inherit');
  });

  it('fills the gap between stderr and the cnf fd with "ignore"', () => {
    const fd = 7;
    const stdio = buildChildStdio(fd, 'pipe');
    // indices 3..fd-1 must be 'ignore' (the array must be dense for spawn).
    for (let i = 3; i < fd; i++) {
      expect(stdio[i]).toBe('ignore');
    }
    expect(stdio[fd]).toBe(fd);
    // Array length is exactly fd+1 (no trailing holes).
    expect(stdio).toHaveLength(fd + 1);
  });

  it('the cnf fd index never collides with 0/1/2', () => {
    const stdio = buildChildStdio(3, 'pipe'); // smallest legal cnf fd
    expect(stdio[3]).toBe(3);
    expect(stdio[0]).toBe('pipe');
    expect(stdio[1]).toBe('inherit');
    expect(stdio[2]).toBe('inherit');
  });

  it('throws if the cnf fd would collide with a standard stream (< 3)', () => {
    for (const bad of [0, 1, 2]) {
      expect(() => buildChildStdio(bad, 'pipe')).toThrow(/collides with a standard stream/);
    }
  });
});
