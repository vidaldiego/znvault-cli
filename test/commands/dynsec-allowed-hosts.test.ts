// Path: test/commands/dynsec-allowed-hosts.test.ts

/**
 * Tests for `znvault dynasec allowed-hosts` and
 * `znvault superadmin dynsec fence` commands.
 *
 * Config isolation: the global test/setup.ts mocks `conf` and sets
 * ZNVAULT_CONFIG_DIR — no vi.resetModules needed here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock cli-table3
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
import { registerSuperadminCommands } from '../../src/commands/superadmin/index.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeDynasecProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerDynamicSecretsCommands(p);
  return p;
}

function makeSuperadminProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerSuperadminCommands(p);
  return p;
}

const SAMPLE_ALLOWED_HOST = {
  id: 'ah-1',
  tenant_id: 'acme',
  host: 'pg.prod.example.com',
  description: 'Production DB',
  enabled: true,
  grandfathered: false,
  verified: true,
  created_by: 'alice',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const SAMPLE_FENCE_ROW = {
  id: 'f-1',
  pattern: '10.0.0.0/24',
  kind: 'cidr',
  description: 'Office subnet',
  enabled: true,
  created_by: 'superadmin',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ═══════════════════════════════════════════════════════════════════════════
// Registration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('command registration', () => {
  it('dynasec group exposes allowed-hosts sub-command with add/list/rm/test', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    expect(dynasec, 'dynasec group must exist').toBeDefined();

    const ah = dynasec!.commands.find((c) => c.name() === 'allowed-hosts');
    expect(ah, 'allowed-hosts sub-command must exist under dynasec').toBeDefined();

    const subNames = ah!.commands.map((c) => c.name());
    expect(subNames).toContain('add');
    expect(subNames).toContain('list');
    expect(subNames).toContain('rm');
    expect(subNames).toContain('test');
  });

  it('superadmin group exposes dynsec → fence with add/list/rm', () => {
    const p = makeSuperadminProgram();
    const superadmin = p.commands.find((c) => c.name() === 'superadmin');
    expect(superadmin, 'superadmin group must exist').toBeDefined();

    const dynsec = superadmin!.commands.find((c) => c.name() === 'dynsec');
    expect(dynsec, 'dynsec sub-group must exist under superadmin').toBeDefined();

    const fence = dynsec!.commands.find((c) => c.name() === 'fence');
    expect(fence, 'fence sub-command must exist under dynsec').toBeDefined();

    const subNames = fence!.commands.map((c) => c.name());
    expect(subNames).toContain('add');
    expect(subNames).toContain('list');
    expect(subNames).toContain('rm');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec allowed-hosts add
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec allowed-hosts add', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeDynasecProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('POSTs to /v1/dynamic-secrets/allowed-hosts with host and prints success', async () => {
    vi.mocked(client.post).mockResolvedValue({ ...SAMPLE_ALLOWED_HOST, verified: true });

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'add', 'pg.prod.example.com']);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/allowed-hosts',
      expect.objectContaining({ host: 'pg.prod.example.com' }),
    );
    expect(output.success).toHaveBeenCalled();
  });

  it('includes optional description in the POST body', async () => {
    vi.mocked(client.post).mockResolvedValue({ ...SAMPLE_ALLOWED_HOST, description: 'My DB' });

    await program.parseAsync([
      'node', 'test', 'dynasec', 'allowed-hosts', 'add', 'pg.prod.example.com',
      '--description', 'My DB',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/allowed-hosts',
      expect.objectContaining({ host: 'pg.prod.example.com', description: 'My DB' }),
    );
  });

  it('warns prominently when verified is false (host did not resolve)', async () => {
    vi.mocked(client.post).mockResolvedValue({ ...SAMPLE_ALLOWED_HOST, verified: false });

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'add', 'unresolvable.internal']);

    expect(output.warn).toHaveBeenCalled();
    const warnCall = vi.mocked(output.warn).mock.calls[0]?.[0] ?? '';
    expect(warnCall.toLowerCase()).toMatch(/unverified|did not resolve|verify/);
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.post).mockResolvedValue(SAMPLE_ALLOWED_HOST);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'allowed-hosts', 'add', 'pg.prod.example.com', '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_ALLOWED_HOST);
  });

  it('exits 1 and prints error on API failure', async () => {
    vi.mocked(client.post).mockRejectedValue(new Error('conflict'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'add', 'bad.host']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('conflict');
  });

  it('surfaces a 409 conflict error message', async () => {
    vi.mocked(client.post).mockRejectedValue(new Error('Host already exists'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'add', 'pg.prod.example.com']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('Host already exists');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec allowed-hosts list
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec allowed-hosts list', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeDynasecProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('GETs /v1/dynamic-secrets/allowed-hosts and prints a table', async () => {
    vi.mocked(client.get).mockResolvedValue({ items: [SAMPLE_ALLOWED_HOST] });

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'list']);

    expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/allowed-hosts');
    expect(consoleSpy).toHaveBeenCalledWith('table-output');
  });

  it('prints empty message when no allowed-hosts exist', async () => {
    vi.mocked(client.get).mockResolvedValue({ items: [] });

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'list']);

    expect(output.info).toHaveBeenCalledWith(expect.stringMatching(/no allowed.?hosts/i));
  });

  it('outputs JSON when --json is passed', async () => {
    const payload = { items: [SAMPLE_ALLOWED_HOST] };
    vi.mocked(client.get).mockResolvedValue(payload);

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'list', '--json']);

    expect(output.json).toHaveBeenCalledWith(payload);
  });

  it('exits 1 on API error', async () => {
    vi.mocked(client.get).mockRejectedValue(new Error('forbidden'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'list']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('forbidden');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec allowed-hosts rm
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec allowed-hosts rm', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeDynasecProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('DELETEs /v1/dynamic-secrets/allowed-hosts/:id and prints removed', async () => {
    vi.mocked(client.delete).mockResolvedValue(undefined);

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'rm', 'ah-1']);

    expect(client.delete).toHaveBeenCalledWith('/v1/dynamic-secrets/allowed-hosts/ah-1');
    expect(output.success).toHaveBeenCalledWith(expect.stringMatching(/removed/i));
  });

  it('exits 1 on API error (e.g. 404)', async () => {
    vi.mocked(client.delete).mockRejectedValue(new Error('not found'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'rm', 'bad-id']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec allowed-hosts test
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec allowed-hosts test', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeDynasecProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('POSTs to /v1/dynamic-secrets/allowed-hosts/test and prints allowed result', async () => {
    const result = { allowed: true, tag: 'public', vettedIp: '1.2.3.4' };
    vi.mocked(client.post).mockResolvedValue(result);

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'test', 'pg.prod.example.com']);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/allowed-hosts/test',
      { host: 'pg.prod.example.com' },
    );
    expect(output.keyValue).toHaveBeenCalled();
  });

  it('prints denied result with reason', async () => {
    const result = { allowed: false, reason: 'not in allowlist' };
    vi.mocked(client.post).mockResolvedValue(result);

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'test', 'bad.host']);

    expect(output.keyValue).toHaveBeenCalled();
  });

  it('outputs JSON when --json is passed', async () => {
    const result = { allowed: true, tag: 'public' };
    vi.mocked(client.post).mockResolvedValue(result);

    await program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'test', 'pg.prod.example.com', '--json']);

    expect(output.json).toHaveBeenCalledWith(result);
  });

  it('exits 1 on API error', async () => {
    vi.mocked(client.post).mockRejectedValue(new Error('server error'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'allowed-hosts', 'test', 'x.example.com']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('server error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// superadmin dynsec fence add
// ═══════════════════════════════════════════════════════════════════════════

describe('superadmin dynsec fence add', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeSuperadminProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('POSTs to /v1/superadmin/dynamic-secrets/fence with pattern and prints created row', async () => {
    vi.mocked(client.post).mockResolvedValue(SAMPLE_FENCE_ROW);

    await program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'add', '10.0.0.0/24']);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/superadmin/dynamic-secrets/fence',
      expect.objectContaining({ pattern: '10.0.0.0/24' }),
    );
    expect(output.success).toHaveBeenCalled();
  });

  it('includes description in POST body when --description is given', async () => {
    vi.mocked(client.post).mockResolvedValue(SAMPLE_FENCE_ROW);

    await program.parseAsync([
      'node', 'test', 'superadmin', 'dynsec', 'fence', 'add', '10.0.0.0/24',
      '--description', 'Office subnet',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/superadmin/dynamic-secrets/fence',
      expect.objectContaining({ pattern: '10.0.0.0/24', description: 'Office subnet' }),
    );
  });

  it('sets force=true in POST body when --force is given', async () => {
    vi.mocked(client.post).mockResolvedValue(SAMPLE_FENCE_ROW);

    await program.parseAsync([
      'node', 'test', 'superadmin', 'dynsec', 'fence', 'add', '10.0.0.0/8', '--force',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/superadmin/dynamic-secrets/fence',
      expect.objectContaining({ pattern: '10.0.0.0/8', force: true }),
    );
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.post).mockResolvedValue(SAMPLE_FENCE_ROW);

    await program.parseAsync([
      'node', 'test', 'superadmin', 'dynsec', 'fence', 'add', '10.0.0.0/24', '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_FENCE_ROW);
  });

  it('exits 1 on 400/validation error', async () => {
    vi.mocked(client.post).mockRejectedValue(new Error('invalid CIDR: not a valid pattern'));

    await expect(
      program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'add', 'bad-cidr']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('invalid CIDR: not a valid pattern');
  });

  it('exits 1 on 409 conflict error', async () => {
    vi.mocked(client.post).mockRejectedValue(new Error('Fence pattern already exists'));

    await expect(
      program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'add', '10.0.0.0/24']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('Fence pattern already exists');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// superadmin dynsec fence list
// ═══════════════════════════════════════════════════════════════════════════

describe('superadmin dynsec fence list', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeSuperadminProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('GETs /v1/superadmin/dynamic-secrets/fence and prints a table', async () => {
    vi.mocked(client.get).mockResolvedValue({ items: [SAMPLE_FENCE_ROW] });

    await program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'list']);

    expect(client.get).toHaveBeenCalledWith('/v1/superadmin/dynamic-secrets/fence');
    expect(consoleSpy).toHaveBeenCalledWith('table-output');
  });

  it('prints empty message when no fence entries exist', async () => {
    vi.mocked(client.get).mockResolvedValue({ items: [] });

    await program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'list']);

    expect(output.info).toHaveBeenCalledWith(expect.stringMatching(/no fence/i));
  });

  it('outputs JSON when --json is passed', async () => {
    const payload = { items: [SAMPLE_FENCE_ROW] };
    vi.mocked(client.get).mockResolvedValue(payload);

    await program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'list', '--json']);

    expect(output.json).toHaveBeenCalledWith(payload);
  });

  it('exits 1 on API error', async () => {
    vi.mocked(client.get).mockRejectedValue(new Error('unauthorized'));

    await expect(
      program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'list']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('unauthorized');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// superadmin dynsec fence rm
// ═══════════════════════════════════════════════════════════════════════════

describe('superadmin dynsec fence rm', () => {
  let program: Command;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeSuperadminProgram();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('DELETEs /v1/superadmin/dynamic-secrets/fence/:id and prints removed', async () => {
    vi.mocked(client.delete).mockResolvedValue(undefined);

    await program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'rm', 'f-1']);

    expect(client.delete).toHaveBeenCalledWith('/v1/superadmin/dynamic-secrets/fence/f-1');
    expect(output.success).toHaveBeenCalledWith(expect.stringMatching(/removed/i));
  });

  it('exits 1 on API error (e.g. 404)', async () => {
    vi.mocked(client.delete).mockRejectedValue(new Error('fence entry not found'));

    await expect(
      program.parseAsync(['node', 'test', 'superadmin', 'dynsec', 'fence', 'rm', 'bad-id']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('fence entry not found');
  });
});
