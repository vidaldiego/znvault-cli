// test/commands/mysql/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerMysqlCommands, parseTtlSeconds } from '../../../src/commands/mysql/index.js';

// ---------------------------------------------------------------------------
// M-2: TTL validation (parseTtlSeconds)
// ---------------------------------------------------------------------------

describe('parseTtlSeconds (M-2)', () => {
  it('returns undefined when --ttl is not provided (server default applies)', () => {
    expect(parseTtlSeconds(undefined)).toBeUndefined();
  });

  it('parses a valid positive integer', () => {
    expect(parseTtlSeconds('1800')).toBe(1800);
  });

  it('throws a clear error for a non-numeric --ttl (no NaN reaches the server)', () => {
    expect(() => parseTtlSeconds('abc')).toThrow(/--ttl.*positive integer/i);
  });

  it('throws a clear error for a zero --ttl', () => {
    expect(() => parseTtlSeconds('0')).toThrow(/--ttl.*positive integer/i);
  });

  it('throws a clear error for a negative --ttl', () => {
    expect(() => parseTtlSeconds('-5')).toThrow(/--ttl.*positive integer/i);
  });

  it('throws for an empty string --ttl', () => {
    expect(() => parseTtlSeconds('')).toThrow(/--ttl.*positive integer/i);
  });

  it('never returns NaN for any input', () => {
    // The whole point: NaN must never slip through to the lease request.
    for (const bad of ['abc', '0', '-1', '', '  ']) {
      expect(() => parseTtlSeconds(bad)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Registration smoke-tests (pre-existing)
// ---------------------------------------------------------------------------

describe('mysql command registration', () => {
  it('registers exec, connect, alias subcommands', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    expect(mysql).toBeDefined();
    const names = mysql!.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['exec', 'connect', 'alias']));
  });

  it('mysql alias has add, list, rm subcommands', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const alias = mysql!.commands.find((c) => c.name() === 'alias');
    expect(alias).toBeDefined();
    const aliasNames = alias!.commands.map((c) => c.name());
    expect(aliasNames).toEqual(expect.arrayContaining(['add', 'list', 'rm']));
  });

  it('mysql exec has --role, --file, --sql, --ttl, --database options', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const exec = mysql!.commands.find((c) => c.name() === 'exec');
    expect(exec).toBeDefined();
    const optNames = exec!.options.map((o) => o.long);
    expect(optNames).toEqual(expect.arrayContaining(['--role', '--file', '--sql', '--ttl', '--database']));
  });

  it('mysql connect has --role, --ttl, --database options', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const connect = mysql!.commands.find((c) => c.name() === 'connect');
    expect(connect).toBeDefined();
    const optNames = connect!.options.map((o) => o.long);
    expect(optNames).toEqual(expect.arrayContaining(['--role', '--ttl', '--database']));
  });
});

// ---------------------------------------------------------------------------
// Regression: options-after-target must parse without "too many arguments"
// ---------------------------------------------------------------------------

describe('mysql exec — parse regression (options after target)', () => {
  beforeEach(() => {
    // Prevent the action from actually running resolveTarget / runBrokered /
    // process.exit by mocking the heavy modules the action calls.
    vi.mock('../../../src/commands/mysql/resolve.js', () => ({
      resolveTarget: vi.fn().mockResolvedValue({ roleId: 'role-uuid' }),
    }));
    vi.mock('../../../src/commands/mysql/broker.js', () => ({
      runBrokered: vi.fn().mockResolvedValue(0),
    }));
    vi.mock('../../../src/commands/mysql/run.js', () => ({
      assertMysqlOnPath: vi.fn(),
      assertPassthroughAllowed: vi.fn(),
      assertSafeMysqlDatabase: vi.fn(),
      runMysql: vi.fn().mockResolvedValue(0),
    }));
    vi.mock('../../../src/commands/mysql/alias.js', () => ({
      addAlias: vi.fn(),
      listAliases: vi.fn().mockReturnValue([]),
      removeAlias: vi.fn(),
    }));
  });

  it('exec <target> --role X --sql Y: does NOT throw "too many arguments" and routes correctly', async () => {
    let capturedTarget: string | undefined;
    let capturedMysqlArgs: string[] | undefined;
    let capturedOpts: Record<string, unknown> | undefined;

    const p = new Command().enablePositionalOptions().exitOverride();
    registerMysqlCommands(p);

    // Override the exec action to capture args instead of executing real logic
    const mysql = p.commands.find((c) => c.name() === 'mysql')!;
    const execCmd = mysql.commands.find((c) => c.name() === 'exec')!;
    execCmd.action((target: string, mysqlArgs: string[], opts: Record<string, unknown>) => {
      capturedTarget = target;
      capturedMysqlArgs = mysqlArgs;
      capturedOpts = opts;
    });

    // This was the broken invocation: options AFTER the target
    // Previously threw: "too many arguments for 'exec'. Expected 1 argument but got 5."
    // Note: `from:'user'` means argv[0] is the first real token (no exe/script prefix).
    await p.parseAsync(['mysql', 'exec', 'staging-mysql', '--role', 'app-rw', '--sql', 'SELECT 1'], { from: 'user' });

    expect(capturedTarget).toBe('staging-mysql');
    expect(capturedOpts).toMatchObject({ role: 'app-rw', sql: 'SELECT 1' });
    // No excess positional args — the options consumed --role and --sql
    expect(capturedMysqlArgs).toEqual([]);
  });

  it('exec <target> -- --batch --silent: post-separator args land in mysqlArgs, not target', async () => {
    let capturedTarget: string | undefined;
    let capturedMysqlArgs: string[] | undefined;

    const p = new Command().enablePositionalOptions().exitOverride();
    registerMysqlCommands(p);

    const mysql = p.commands.find((c) => c.name() === 'mysql')!;
    const execCmd = mysql.commands.find((c) => c.name() === 'exec')!;
    execCmd.action((target: string, mysqlArgs: string[]) => {
      capturedTarget = target;
      capturedMysqlArgs = mysqlArgs;
    });

    await p.parseAsync(['mysql', 'exec', 'staging-mysql', '--role', 'app-rw', '--', '--batch', '--silent'], { from: 'user' });

    expect(capturedTarget).toBe('staging-mysql');
    // The `--` separator itself must NOT appear in mysqlArgs — Commander strips it
    expect(capturedMysqlArgs).toEqual(['--batch', '--silent']);
    expect(capturedMysqlArgs).not.toContain('--');
  });
});

// ---------------------------------------------------------------------------
// Regression: connect options-after-target
// ---------------------------------------------------------------------------

describe('mysql connect — parse regression (options after target)', () => {
  it('connect <target> --role X: does NOT throw "too many arguments"', async () => {
    let capturedTarget: string | undefined;
    let capturedOpts: Record<string, unknown> | undefined;

    const p = new Command().enablePositionalOptions().exitOverride();
    registerMysqlCommands(p);

    const mysql = p.commands.find((c) => c.name() === 'mysql')!;
    const connectCmd = mysql.commands.find((c) => c.name() === 'connect')!;
    connectCmd.action((target: string, _mysqlArgs: string[], opts: Record<string, unknown>) => {
      capturedTarget = target;
      capturedOpts = opts;
    });

    await p.parseAsync(['mysql', 'connect', 'staging-mysql', '--role', 'app-rw'], { from: 'user' });

    expect(capturedTarget).toBe('staging-mysql');
    expect(capturedOpts).toMatchObject({ role: 'app-rw' });
  });

  it('connect <target> -- --table: post-separator args land in mysqlArgs without the -- itself', async () => {
    let capturedMysqlArgs: string[] | undefined;

    const p = new Command().enablePositionalOptions().exitOverride();
    registerMysqlCommands(p);

    const mysql = p.commands.find((c) => c.name() === 'mysql')!;
    const connectCmd = mysql.commands.find((c) => c.name() === 'connect')!;
    connectCmd.action((_target: string, mysqlArgs: string[]) => {
      capturedMysqlArgs = mysqlArgs;
    });

    await p.parseAsync(['mysql', 'connect', 'staging-mysql', '--', '--table'], { from: 'user' });

    expect(capturedMysqlArgs).toEqual(['--table']);
    expect(capturedMysqlArgs).not.toContain('--');
  });
});
