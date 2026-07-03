// Path: test/commands/dynsec-routines.test.ts

/**
 * Tests for the `znvault dynasec connection update --routines-connection-string`
 * plumbing.
 *
 * The `znvault dynasec routines apply/get/bundles` command (which drove the
 * server's migration bundle-apply route) has been removed — that route is
 * gone. This file's remaining scope is the orthogonal
 * `connection update --routines-connection-string` flag, which stores the
 * persistent "routines" sub-account credential and is unrelated to the
 * removed apply/get/bundles surface.
 *
 * Config isolation: the global test/setup.ts mocks `conf` and sets
 * ZNVAULT_CONFIG_DIR — no vi.resetModules needed here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock cli-table3 (imported transitively via connection.ts/role.ts in the same registration)
vi.mock('cli-table3', () => ({
  default: class MockTable {
    push = vi.fn();
    toString = vi.fn().mockReturnValue('table-output');
  },
}));

// Mock inquirer (not used by these commands, but imported transitively)
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

// ═══════════════════════════════════════════════════════════════════════════
// Registration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('command registration', () => {
  it('connection update exposes --routines-connection-string', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    const connection = dynasec!.commands.find((c) => c.name() === 'connection');
    const update = connection!.commands.find((c) => c.name() === 'update');
    const optionNames = update!.options.map((o) => o.long);
    expect(optionNames).toContain('--routines-connection-string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec connection update --routines-connection-string
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec connection update --routines-connection-string', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PATCHes with routinesConnectionString in the body', async () => {
    vi.mocked(client.patch).mockResolvedValueOnce({ id: 'conn-1', name: 'my-mysql' });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'update', 'conn-1',
      '--routines-connection-string', 'mysql://routines_user:pw@10.0.0.5:3306/db',
    ]);

    expect(client.patch).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/conn-1',
      expect.objectContaining({
        routinesConnectionString: 'mysql://routines_user:pw@10.0.0.5:3306/db',
      }),
    );
  });

  it('omits routinesConnectionString when not provided', async () => {
    vi.mocked(client.patch).mockResolvedValueOnce({ id: 'conn-1', name: 'my-mysql' });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'connection', 'update', 'conn-1',
      '--description', 'updated',
    ]);

    const body = vi.mocked(client.patch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('routinesConnectionString');
  });
});
