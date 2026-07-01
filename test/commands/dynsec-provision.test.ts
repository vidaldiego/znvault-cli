// Path: test/commands/dynsec-provision.test.ts

/**
 * Tests for `znvault dynasec connection provision` and
 * `znvault dynasec connection rotate-admin`.
 *
 * LOAD-BEARING: the root connection string is NEVER accepted as an inline
 * flag (argv leaks to shell history / `ps`). It is read from a file path
 * given via `--root-file`, or otherwise prompted for interactively with a
 * masked (`type: 'password'`) inquirer prompt.
 *
 * Config isolation: the global test/setup.ts mocks `conf` and sets
 * ZNVAULT_CONFIG_DIR — no vi.resetModules needed here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock cli-table3 (imported transitively via connection.ts/role.ts in the same registration).
// Track pushed rows on a module-level array so tests can assert on step-report content
// without depending on the (irrelevant) rendered table string.
const tablePushedRows: unknown[][] = [];
vi.mock('cli-table3', () => ({
  default: class MockTable {
    push(...rows: unknown[][]): void {
      tablePushedRows.push(...rows);
    }
    toString(): string {
      return 'table-output';
    }
  },
}));

// Mock inquirer — used for the masked root-connection-string prompt fallback.
vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}));

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
    isSpinning: false,
  })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  isPlainMode: vi.fn().mockReturnValue(true),
}));

import { client } from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';
import inquirer from 'inquirer';
import { registerDynamicSecretsCommands } from '../../src/commands/dynamic-secrets.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeDynasecProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerDynamicSecretsCommands(p);
  return p;
}

function setupProgram(): { program: Command; exitSpy: ReturnType<typeof vi.spyOn>; consoleSpy: ReturnType<typeof vi.spyOn> } {
  vi.clearAllMocks();
  const program = makeDynasecProgram();
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
    throw new Error(`process.exit(${code})`);
  });
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { program, exitSpy, consoleSpy };
}

function writeTempRootFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-root-'));
  const file = path.join(dir, 'root-conn.txt');
  fs.writeFileSync(file, contents, { mode: 0o600 });
  return file;
}

const ROOT_CONN = 'mysql://root:supersecret@10.0.0.5:3306/mysql';

const SAMPLE_PROVISION_REPORT = {
  connectionId: 'conn-1',
  name: 'my-mysql',
  steps: [
    { step: 'validate_root', status: 'ok' },
    { step: 'create_admin_account', status: 'ok' },
    { step: 'store_connection', status: 'ok' },
  ],
  provisioned: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// Registration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('command registration', () => {
  it('dynasec connection group exposes provision and rotate-admin sub-commands', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    const connection = dynasec!.commands.find((c) => c.name() === 'connection');

    const subNames = connection!.commands.map((c) => c.name());
    expect(subNames).toContain('provision');
    expect(subNames.some((n) => n === 'rotate-admin')).toBe(true);
  });

  it('provision does NOT expose an inline --root flag (root must come from --root-file or prompt)', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    const connection = dynasec!.commands.find((c) => c.name() === 'connection');
    const provision = connection!.commands.find((c) => c.name() === 'provision');

    const optionNames = provision!.options.map((o) => o.long);
    expect(optionNames).toContain('--root-file');
    expect(optionNames).not.toContain('--root');
    expect(optionNames).not.toContain('--root-connection-string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec connection provision
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec connection provision', () => {
  let program: Command;
  let rootFile: string;

  beforeEach(() => {
    ({ program } = setupProgram());
    rootFile = writeTempRootFile(ROOT_CONN);
    tablePushedRows.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.dirname(rootFile), { recursive: true, force: true });
  });

  it('reads the root connection string from --root-file and POSTs the provision body', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql', '--root-file', rootFile,
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/provision',
      expect.objectContaining({
        name: 'my-mysql',
        connectionType: 'MYSQL',
        rootConnectionString: ROOT_CONN,
      }),
    );
    // Never prompts when --root-file is given.
    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it('never accepts the root credential as an inline argv flag', () => {
    // Structural guard (see registration test above) — re-asserted here to make
    // the load-bearing constraint obvious from within this describe block too.
    const connection = program.commands
      .find((c) => c.name() === 'dynasec')!
      .commands.find((c) => c.name() === 'connection')!;
    const provision = connection.commands.find((c) => c.name() === 'provision')!;
    expect(provision.options.map((o) => o.long)).not.toContain('--root');
  });

  it('falls back to a masked interactive prompt when --root-file is absent', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ rootConnectionString: ROOT_CONN });
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql',
    ]);

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'password', mask: '*' }),
      ]),
    );
    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/provision',
      expect.objectContaining({ rootConnectionString: ROOT_CONN }),
    );
  });

  it('includes accountPrefix when --account-prefix is given', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql', '--root-file', rootFile, '--account-prefix', 'zn_',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/provision',
      expect.objectContaining({ accountPrefix: 'zn_' }),
    );
  });

  it('includes routines bundle/version when both --routines-bundle and --routines-version are given', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql', '--root-file', rootFile,
      '--routines-bundle', 'znapi-helpers', '--routines-version', '1',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/provision',
      expect.objectContaining({
        routines: { bundle: 'znapi-helpers', version: 1 },
      }),
    );
  });

  it('errors when --routines-bundle is given without --routines-version', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'mysql', '--root-file', rootFile, '--routines-bundle', 'znapi-helpers',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/--routines-version/));
    expect(client.post).not.toHaveBeenCalled();
  });

  it('requires --type', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--root-file', rootFile,
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/--type is required/));
  });

  it('rejects an unknown --type', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'oracle', '--root-file', rootFile,
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/mysql.*postgresql|postgresql.*mysql/i));
  });

  it('errors clearly when --root-file does not exist', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'mysql', '--root-file', '/nonexistent/path/root.txt',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/root-file/i));
    expect(client.post).not.toHaveBeenCalled();
  });

  it('prints the per-step report on success (non-JSON)', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql', '--root-file', rootFile,
    ]);

    expect(output.success).toHaveBeenCalled();
    // Step report is rendered via a Table whose rows were pushed with each
    // step's name/status — verify the steps made it into the table.
    const flattened = tablePushedRows.flat();
    expect(flattened).toContain('create_admin_account');
  });

  it('outputs raw JSON when --json is passed', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_PROVISION_REPORT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
      '--type', 'mysql', '--root-file', rootFile, '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_PROVISION_REPORT);
  });

  it('surfaces the server error message on failure (e.g. 422 root_insufficient)', async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error('root_insufficient'));

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'mysql', '--root-file', rootFile,
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/root_insufficient/));
  });

  it('renders the partial step report when a failed provision error carries .steps (e.g. 422 root_insufficient)', async () => {
    const err = new Error('root_insufficient') as Error & {
      statusCode?: number;
      errorCode?: string;
      steps?: unknown[];
    };
    err.statusCode = 422;
    err.errorCode = 'root_insufficient';
    err.steps = [
      { step: 'lock', status: 'acquired' },
      { step: 'preflight', status: 'failed' },
    ];
    vi.mocked(client.post).mockRejectedValueOnce(err);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'mysql', '--root-file', rootFile,
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/root_insufficient/));
    // The per-step table must include where the process stopped.
    const flattened = tablePushedRows.flat();
    expect(flattened).toContain('preflight');
    expect(flattened).toContain('failed');
  });

  it('falls back to the "check connection get" hint when the error has no .steps', async () => {
    const err = new Error('provision failed') as Error & { statusCode?: number };
    err.statusCode = 502;
    vi.mocked(client.post).mockRejectedValueOnce(err);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'provision', 'my-mysql',
        '--type', 'mysql', '--root-file', rootFile,
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.info).toHaveBeenCalledWith(expect.stringMatching(/connection get my-mysql/));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec connection rotate-admin
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec connection rotate-admin', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the rotate-admin route for the given connection id', async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ rotated: true });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'rotate-admin', 'conn-1',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/conn-1/rotate-admin',
      {},
    );
    expect(output.success).toHaveBeenCalled();
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ rotated: true });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'rotate-admin', 'conn-1', '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith({ rotated: true });
  });

  it('exits 1 and surfaces the error on failure', async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error('connection not found'));

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'rotate-admin', 'conn-1',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/connection not found/));
  });
});
