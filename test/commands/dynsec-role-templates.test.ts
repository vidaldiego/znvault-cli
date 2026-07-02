// Path: test/commands/dynsec-role-templates.test.ts

/**
 * Tests for:
 *   - `znvault dynasec role create <connection-id> --template <name> [--template-version <n>]`
 *     (template mode — POSTs `{ name, template: { name, version? } }`)
 *   - `znvault dynasec templates list [--engine mysql|postgresql]`
 *   - `znvault dynasec templates get <engine>/<name>/<version>`
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

// Mock inquirer (role create falls back to prompts when flags are missing)
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

function setupProgram(): { program: Command; exitSpy: ReturnType<typeof vi.spyOn>; consoleSpy: ReturnType<typeof vi.spyOn> } {
  vi.clearAllMocks();
  const program = makeDynasecProgram();
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
    throw new Error(`process.exit(${code})`);
  });
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { program, exitSpy, consoleSpy };
}

const SAMPLE_ROLE = {
  id: 'role-1',
  tenantId: 'acme',
  connectionId: 'conn-1',
  connectionName: 'my-mysql',
  name: 'readwrite',
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

const SAMPLE_ROLE_WITH_WARNINGS = {
  ...SAMPLE_ROLE,
  warnings: ['bundle_not_applied'],
};

const SAMPLE_TEMPLATES = [
  { engine: 'mysql', name: 'readonly', version: 1, description: 'Read-only MySQL access', params: {} },
  { engine: 'mysql', name: 'readwrite', version: 1, description: 'Read-write MySQL access', params: {} },
  { engine: 'mysql', name: 'ddl', version: 1, description: 'DDL MySQL access', params: {} },
  { engine: 'mysql', name: 'migrate', version: 1, description: 'Migration MySQL access (needs routine bundle)', params: {} },
  { engine: 'postgresql', name: 'readonly', version: 1, description: 'Read-only PostgreSQL access', params: {} },
  { engine: 'postgresql', name: 'readwrite', version: 1, description: 'Read-write PostgreSQL access', params: {} },
];

const SAMPLE_TEMPLATE_DETAIL = {
  engine: 'mysql',
  name: 'readwrite',
  version: 1,
  description: 'Read-write MySQL access',
  params: {},
  example: {
    creationStatements: ['CREATE USER \'{{username}}\'@\'%\' IDENTIFIED BY \'{{password}}\';'],
    revocationStatements: ['DROP USER IF EXISTS \'{{username}}\'@\'%\';'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Registration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('command registration', () => {
  it('dynasec group exposes a templates sub-command with list/get', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    expect(dynasec, 'dynasec group must exist').toBeDefined();

    const templates = dynasec!.commands.find((c) => c.name() === 'templates');
    expect(templates, 'templates sub-command must exist under dynasec').toBeDefined();

    const subNames = templates!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
    expect(subNames).toContain('get');
  });

  it('role create exposes --template and --template-version', () => {
    const p = makeDynasecProgram();
    const dynasec = p.commands.find((c) => c.name() === 'dynasec');
    const role = dynasec!.commands.find((c) => c.name() === 'role');
    const create = role!.commands.find((c) => c.name() === 'create');
    const optionNames = create!.options.map((o) => o.long);
    expect(optionNames).toContain('--template');
    expect(optionNames).toContain('--template-version');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec role create --template
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec role create --template', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs { name, template: { name, version } } in template mode', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite', '--template', 'readwrite', '--template-version', '1',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/conn-1/roles',
      { name: 'readwrite', template: { name: 'readwrite', version: 1 } },
    );
    expect(output.success).toHaveBeenCalled();
  });

  it('omits version from the template object when --template-version is not given', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite', '--template', 'readwrite',
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/conn-1/roles',
      { name: 'readwrite', template: { name: 'readwrite' } },
    );
  });

  it('does not send creationStatements/revocationStatements/usernameTemplate in template mode', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite', '--template', 'readwrite', '--template-version', '1',
    ]);

    const body = vi.mocked(client.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('creationStatements');
    expect(body).not.toHaveProperty('revocationStatements');
    expect(body).not.toHaveProperty('usernameTemplate');
  });

  it('prints warnings from the 201 body (e.g. bundle_not_applied)', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE_WITH_WARNINGS);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite', '--template', 'migrate',
    ]);

    expect(output.warn).toHaveBeenCalledWith(expect.stringMatching(/bundle_not_applied/));
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite', '--template', 'readwrite', '--json',
    ]);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_ROLE);
  });

  it('errors client-side when both --template and --creation-statements are given', async () => {
    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
        '--name', 'readwrite', '--template', 'readwrite',
        '--creation-statements', "CREATE USER '{{username}}'@'%';",
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(client.post).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/template.*raw|raw.*template/i));
  });

  it('still supports raw mode (creation/revocation statements) without --template', async () => {
    vi.mocked(client.post).mockResolvedValueOnce(SAMPLE_ROLE);

    await program.parseAsync([
      'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
      '--name', 'readwrite',
      '--creation-statements', "CREATE USER '{{username}}'@'%' IDENTIFIED BY '{{password}}';",
      '--revocation-statements', "DROP USER IF EXISTS '{{username}}'@'%';",
    ]);

    expect(client.post).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/connections/conn-1/roles',
      expect.objectContaining({
        name: 'readwrite',
        creationStatements: ["CREATE USER '{{username}}'@'%' IDENTIFIED BY '{{password}}'"],
        revocationStatements: ["DROP USER IF EXISTS '{{username}}'@'%'"],
      }),
    );
    const body = vi.mocked(client.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('template');
  });

  it('surfaces a 403 write-raw permission error clearly', async () => {
    const err = new Error('forbidden') as Error & { statusCode?: number; errorCode?: string };
    err.statusCode = 403;
    err.errorCode = 'forbidden';
    vi.mocked(client.post).mockRejectedValueOnce(err);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
        '--name', 'readwrite',
        '--creation-statements', "CREATE USER '{{username}}'@'%';",
        '--revocation-statements', "DROP USER IF EXISTS '{{username}}'@'%';",
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/write-raw/i));
  });

  it('surfaces ddl_unsupported_for_engine clearly', async () => {
    const err = new Error('ddl_unsupported_for_engine') as Error & { statusCode?: number; errorCode?: string };
    err.statusCode = 400;
    err.errorCode = 'ddl_unsupported_for_engine';
    vi.mocked(client.post).mockRejectedValueOnce(err);

    await expect(
      program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'create', 'conn-1',
        '--name', 'ddl-role', '--template', 'ddl',
      ]),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/postgresql.*ddl|ddl.*postgresql|does not support/i));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec templates list
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec templates list', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /v1/dynamic-secrets/templates', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({
      items: SAMPLE_TEMPLATES,
      pagination: { total: SAMPLE_TEMPLATES.length, limit: 50, offset: 0, hasMore: false },
    });

    await program.parseAsync(['node', 'test', 'dynasec', 'templates', 'list']);

    expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/templates');
  });

  it('GETs with ?engine= when --engine is passed', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({
      items: SAMPLE_TEMPLATES.filter((t) => t.engine === 'mysql'),
      pagination: { total: 4, limit: 50, offset: 0, hasMore: false },
    });

    await program.parseAsync(['node', 'test', 'dynasec', 'templates', 'list', '--engine', 'mysql']);

    expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/templates?engine=mysql');
  });

  it('outputs JSON when --json is passed', async () => {
    const response = {
      items: SAMPLE_TEMPLATES,
      pagination: { total: SAMPLE_TEMPLATES.length, limit: 50, offset: 0, hasMore: false },
    };
    vi.mocked(client.get).mockResolvedValueOnce(response);

    await program.parseAsync(['node', 'test', 'dynasec', 'templates', 'list', '--json']);

    expect(output.json).toHaveBeenCalledWith(response);
  });

  it('exits 1 on API error', async () => {
    vi.mocked(client.get).mockRejectedValueOnce(new Error('server error'));

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'templates', 'list']),
    ).rejects.toThrow('process.exit(1)');
    expect(output.error).toHaveBeenCalledWith('server error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dynasec templates get
// ═══════════════════════════════════════════════════════════════════════════

describe('dynasec templates get', () => {
  let program: Command;

  beforeEach(() => {
    ({ program } = setupProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /v1/dynamic-secrets/templates/:engine/:name/:version', async () => {
    vi.mocked(client.get).mockResolvedValueOnce(SAMPLE_TEMPLATE_DETAIL);

    await program.parseAsync(['node', 'test', 'dynasec', 'templates', 'get', 'mysql/readwrite/1']);

    expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/templates/mysql/readwrite/1');
  });

  it('outputs JSON when --json is passed', async () => {
    vi.mocked(client.get).mockResolvedValueOnce(SAMPLE_TEMPLATE_DETAIL);

    await program.parseAsync(['node', 'test', 'dynasec', 'templates', 'get', 'mysql/readwrite/1', '--json']);

    expect(output.json).toHaveBeenCalledWith(SAMPLE_TEMPLATE_DETAIL);
  });

  it('rejects a malformed engine/name/version argument client-side', async () => {
    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'templates', 'get', 'mysql-readwrite-1']),
    ).rejects.toThrow('process.exit(1)');

    expect(client.get).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/engine\/name\/version/i));
  });

  it('surfaces a 404 as a clear "template not found" message', async () => {
    const err = new Error('not_found') as Error & { statusCode?: number };
    err.statusCode = 404;
    vi.mocked(client.get).mockRejectedValueOnce(err);

    await expect(
      program.parseAsync(['node', 'test', 'dynasec', 'templates', 'get', 'mysql/bogus/1']),
    ).rejects.toThrow('process.exit(1)');

    expect(output.error).toHaveBeenCalledWith(expect.stringMatching(/template not found/i));
  });
});
