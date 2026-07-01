// Path: test/commands/dynsec-routines.test.ts

/**
 * Tests for `znvault dynasec routines` commands.
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
import * as output from '../../src/lib/output.js';
import { registerDynamicSecretsCommands } from '../../src/commands/dynamic-secrets.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeDynasecProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerDynamicSecretsCommands(p);
  return p;
}

const SAMPLE_ROLE = {
  id: 'role-1',
  tenantId: 'acme',
  connectionId: 'conn-1',
  connectionName: 'my-mysql',
  name: 'readonly',
  description: null,
  defaultTtlSeconds: 3600,
  maxTtlSeconds: 86400,
  usernameTemplate: 'v_{{role}}_{{random:8}}',
  isEnabled: true,
  createdBy: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  activeLeases: 0,
};

const SAMPLE_ROLE_2 = { ...SAMPLE_ROLE, id: 'role-2', name: 'readwrite' };

const SAMPLE_APPLY_RESULT = {
  connectionId: 'conn-1',
  bundle: 'znapi-helpers',
  version: 1,
  appliedRoutines: 3,
  applied: true,
};

const SAMPLE_GET_RESULT = {
  configured: true,
  bundle: 'znapi-helpers',
  version: 1,
  lastAppliedAt: '2026-01-01T00:00:00Z',
  lastAppliedHash: 'abc123',
};

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
  it('dynasec group exposes routines sub-command with apply/get/bundles', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    expect(dynasec, 'dynasec group must exist').toBeDefined();

    const routines = dynasec!.commands.find((c) => c.name() === 'routines');
    expect(routines, 'routines sub-command must exist under dynasec').toBeDefined();

    const subNames = routines!.commands.map((c) => c.name());
    expect(subNames).toContain('apply');
    expect(subNames).toContain('get');
    expect(subNames).toContain('bundles');
  });

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
// dynasec routines apply
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec routines apply', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a direct role id and POSTs bundle/version', async () => {
    vi.mocked(client.get).mockResolvedValueOnce(SAMPLE_ROLE); // role lookup succeeds
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_APPLY_RESULT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'routines', 'apply', 'role-1',
      '--bundle', 'znapi-helpers', '--version', '1',
    ]);

    expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-1');
    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/roles/role-1/routines',
      { bundle: 'znapi-helpers', version: 1 },
    );
    expect(output.success).toHaveBeenCalled();
  });

  it('resolves a connection id with exactly one role', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found')) // role lookup fails
      .mockResolvedValueOnce([SAMPLE_ROLE]); // connection roles list
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_APPLY_RESULT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'routines', 'apply', 'conn-1',
      '--bundle', 'znapi-helpers', '--version', '1',
    ]);

    expect(client.get).toHaveBeenNthCalledWith(1, '/v1/dynamic-secrets/roles/conn-1');
    expect(client.get).toHaveBeenNthCalledWith(2, '/v1/dynamic-secrets/connections/conn-1/roles');
    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/roles/role-1/routines',
      { bundle: 'znapi-helpers', version: 1 },
    );
  });

  it('requires --role to disambiguate when a connection has multiple roles', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce([SAMPLE_ROLE, SAMPLE_ROLE_2]);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'routines', 'apply', 'conn-1',
        '--bundle', 'znapi-helpers', '--version', '1',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(client.post).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/multiple roles/i));
  });

  it('uses --role to disambiguate by name when a connection has multiple roles', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce([SAMPLE_ROLE, SAMPLE_ROLE_2]);
    vi.mocked(client.post).mockResolvedValueOnce({ ...SAMPLE_APPLY_RESULT });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'routines', 'apply', 'conn-1',
      '--bundle', 'znapi-helpers', '--version', '1', '--role', 'readwrite',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/roles/role-2/routines',
      { bundle: 'znapi-helpers', version: 1 },
    );
  });

  it('errors when the connection has zero roles', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce([]);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'routines', 'apply', 'conn-1',
        '--bundle', 'znapi-helpers', '--version', '1',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/no roles/i));
  });

  it('errors when neither a role nor a connection can be resolved', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'));

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'routines', 'apply', 'bogus',
        '--bundle', 'znapi-helpers', '--version', '1',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/not a known role or connection/i));
  });

  it('requires --bundle', async () => {
    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'routines', 'apply', 'role-1', '--version', '1']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/--bundle is required/));
  });

  it('requires --version', async () => {
    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'routines', 'apply', 'role-1', '--bundle', 'znapi-helpers']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/--version is required/));
  });

  it('rejects a non-integer --version', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'routines', 'apply', 'role-1',
        '--bundle', 'znapi-helpers', '--version', 'abc',
      ]),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/positive integer/));
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.get).mockResolvedValueOnce(SAMPLE_ROLE);
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_APPLY_RESULT);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'routines', 'apply', 'role-1',
      '--bundle', 'znapi-helpers', '--version', '1', '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_APPLY_RESULT);
  });

  it('surfaces a 409 unsupported_connection_type error', async () => {
    vi.mocked(client.get).mockResolvedValueOnce(SAMPLE_ROLE);
    vi.mocked(client.post).mockRejectedValueOnce(new Error('unsupported_connection_type'));

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'routines', 'apply', 'role-1',
        '--bundle', 'znapi-helpers', '--version', '1',
      ]),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('unsupported_connection_type');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec routines get
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec routines get', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a direct role id and GETs routine state', async () => {
    vi.mocked(client.get)
      .mockResolvedValueOnce(SAMPLE_ROLE) // role lookup
      .mockResolvedValueOnce(SAMPLE_GET_RESULT); // routines get

    await program.parseAsync(['node', 'test', 'dynasec', 'routines', 'get', 'role-1']);

    expect(client.get).toHaveBeenNthCalledWith(1, '/v1/dynamic-secrets/roles/role-1');
    expect(client.get).toHaveBeenNthCalledWith(2, '/v1/dynamic-secrets/roles/role-1/routines');
    expect(output.keyValue).toHaveBeenCalled();
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.get)
      .mockResolvedValueOnce(SAMPLE_ROLE)
      .mockResolvedValueOnce(SAMPLE_GET_RESULT);

    await program.parseAsync(['node', 'test', 'dynasec', 'routines', 'get', 'role-1', '--json']);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_GET_RESULT);
  });

  it('resolves via a connection id with one role', async () => {
    vi.mocked(client.get)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce([SAMPLE_ROLE])
      .mockResolvedValueOnce(SAMPLE_GET_RESULT);

    await program.parseAsync(['node', 'test', 'dynasec', 'routines', 'get', 'conn-1']);

    expect(client.get).toHaveBeenNthCalledWith(3, '/v1/dynamic-secrets/roles/role-1/routines');
  });

  it('exits 1 on API error', async () => {
    vi.mocked(client.get)
      .mockResolvedValueOnce(SAMPLE_ROLE)
      .mockRejectedValueOnce(new Error('forbidden'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'routines', 'get', 'role-1']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('forbidden');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec routines bundles
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec routines bundles', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a warning (no server endpoint) and lists the known bundle catalog', async () => {
    await program.parseAsync(['node', 'test', 'dynasec', 'routines', 'bundles']);

    expect(output.warn).toHaveBeenCalledWith(expect.stringMatching(/no server endpoint/i));
    expect(output.info).toHaveBeenCalledWith(expect.stringMatching(/znapi-helpers v1/));
    expect(client.get).not.toHaveBeenCalled();
  });

  it('outputs JSON when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'dynasec', 'routines', 'bundles', '--json']);

    expect(output.json).toHaveBeenCalledWith({
      items: [{ name: 'znapi-helpers', version: 1, description: expect.any(String) }],
    });
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
