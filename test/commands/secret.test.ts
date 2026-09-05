// Path: znvault-cli/test/commands/secret.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { mockReadStdinUtf8 } = vi.hoisted(() => ({
  mockReadStdinUtf8: vi.fn(),
}));

// Default `client.get` behaviour. Kept as a named function so afterEach can
// reinstall it: tests that stub `client.get` with a persistent
// mockImplementation (see stubMeta) must not leak into later tests —
// vi.clearAllMocks() clears calls, not implementations.
function defaultClientGet(path: string): Promise<unknown> {
  if (path.includes('/v1/secrets?')) return Promise.resolve({ items: mockSecrets, pagination: { total: 2, page: 1, pageSize: 20, totalPages: 1 } });
  if (path.includes('/meta')) return Promise.resolve(mockSecretMetadata);
  if (path.includes('/history')) return Promise.resolve({ items: [{ version: 1, createdAt: new Date().toISOString() }], pagination: { total: 1, limit: 50, offset: 0, hasMore: false } });
  return Promise.resolve(mockSecretMetadata);
}

vi.mock('../../src/lib/stdin.js', () => ({
  readStdinUtf8: mockReadStdinUtf8,
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
}));

// Mock dependencies
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({
      confirm: true,
      dataType: 'credential',
      username: 'user',
      password: 'pass',
      dataJson: '{"apiKey": "new-key"}',
    }),
  },
}));

const mockSecrets = [
  {
    id: 'secret-1',
    alias: 'web/prod/api-key',
    tenant: 'acme',
    type: 'opaque',
    version: 1,
    tags: ['production'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'secret-2',
    alias: 'db/prod/credentials',
    tenant: 'acme',
    type: 'credential',
    version: 2,
    tags: ['production', 'database'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockSecretMetadata = {
  id: 'secret-1',
  alias: 'web/prod/api-key',
  tenant: 'acme',
  type: 'opaque',
  version: 1,
  tags: ['production'],
  createdBy: 'admin',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockDecryptedSecret = {
  ...mockSecretMetadata,
  data: { apiKey: 'sk-test-123', endpoint: 'https://api.example.com' },
};

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => defaultClientGet(path)),
    post: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/decrypt')) return Promise.resolve(mockDecryptedSecret);
      if (path.includes('/rotate')) return Promise.resolve({ ...mockSecretMetadata, version: 2 });
      return Promise.resolve(mockSecretMetadata);
    }),
    patch: vi.fn().mockResolvedValue(mockSecretMetadata),
    put: vi.fn().mockResolvedValue(mockSecretMetadata),
    delete: vi.fn().mockResolvedValue(undefined),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token', tenantId: 'acme', role: 'admin' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
  hasApiKey: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  json: vi.fn(),
  keyValue: vi.fn(),
  section: vi.fn(),
}));

describe('secret commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);

    const { registerSecretCommands } = await import('../../src/commands/secret.js');
    registerSecretCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
    const { client } = await import('../../src/lib/client.js');
    vi.mocked(client.get).mockImplementation((path: string) => defaultClientGet(path));
  });

  describe('secret list', () => {
    it('should list all secrets', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'list']);

      expect(client.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 secret(s)');
    });

    it('rejects --tenant (removed in v3.0.0)', async () => {
      // `--tenant` was removed from `secret list` in v3.0.0 because secrets
      // are tenant data and the server derives tenant from the JWT.
      await expect(
        program.parseAsync(['node', 'test', 'secret', 'list', '--tenant', 'acme'])
      ).rejects.toThrow(/unknown option/);
    });

    it('should filter by type', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'list', '--type', 'credential']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('type=credential'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'list', '--json']);

      expect(json).toHaveBeenCalledWith({ items: mockSecrets, pagination: expect.any(Object) });
    });
  });

  describe('secret get', () => {
    it('should get secret metadata', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'get', 'secret-1']);

      expect(client.get).toHaveBeenCalledWith('/v1/secrets/secret-1/meta');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'get', 'secret-1', '--json']);

      expect(json).toHaveBeenCalledWith(mockSecretMetadata);
    });
  });

  describe('secret get — references row + timestamps', () => {
    const isoNow = new Date().toISOString();

    // Point resolveSecretId at a UUID so it passes through, then serve /meta.
    function stubMeta(
      mockedClient: Awaited<ReturnType<typeof import('../../src/lib/client.js')>>['client'],
      meta: Record<string, unknown>,
    ): void {
      vi.mocked(mockedClient.get).mockImplementation((path: string) => {
        if (path.includes('/meta')) return Promise.resolve(meta as never);
        return Promise.resolve(meta as never);
      });
    }

    it('renders "link secret" and the --no-resolve tip for a link secret', async () => {
      const { client } = await import('../../src/lib/client.js');
      stubMeta(client, {
        id: 'secret-1', alias: 'api/current-key', tenant: 'acme',
        type: 'setting', subType: 'link', version: 3,
        createdBy: 'admin', createdAt: isoNow, updatedAt: isoNow,
        referencesEnabled: true, hasReferences: true,
      });

      await program.parseAsync(['node', 'test', 'secret', 'get', 'api/current-key']);

      // The rendered cli-table3 string is logged as one console.log call.
      const tableOut = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(tableOut).toContain('References');
      expect(tableOut).toContain('link secret');
      // Tip line for a link.
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("secret decrypt <alias> --no-resolve"),
      );
    });

    it('renders "enabled · has tokens" and the resolve tip for an opted-in secret with tokens', async () => {
      const { client } = await import('../../src/lib/client.js');
      stubMeta(client, {
        id: 'secret-1', alias: 'app/db-url', tenant: 'acme',
        type: 'setting', subType: 'env', version: 1,
        createdBy: 'admin', createdAt: isoNow, updatedAt: isoNow,
        referencesEnabled: true, hasReferences: true,
      });

      await program.parseAsync(['node', 'test', 'secret', 'get', 'app/db-url']);

      const tableOut = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(tableOut).toContain('References');
      expect(tableOut).toContain('enabled · has tokens');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("resolves references"),
      );
    });

    it('renders "enabled · no tokens yet" for an opted-in secret without tokens', async () => {
      const { client } = await import('../../src/lib/client.js');
      stubMeta(client, {
        id: 'secret-1', alias: 'app/config', tenant: 'acme',
        type: 'setting', subType: 'env', version: 1,
        createdBy: 'admin', createdAt: isoNow, updatedAt: isoNow,
        referencesEnabled: true, hasReferences: false,
      });

      await program.parseAsync(['node', 'test', 'secret', 'get', 'app/config']);

      const tableOut = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(tableOut).toContain('enabled · no tokens yet');
    });

    it('does NOT render a References row for a plain secret (references off)', async () => {
      const { client } = await import('../../src/lib/client.js');
      stubMeta(client, {
        id: 'secret-1', alias: 'web/prod/api-key', tenant: 'acme',
        type: 'opaque', version: 1,
        createdBy: 'admin', createdAt: isoNow, updatedAt: isoNow,
        referencesEnabled: false, hasReferences: false,
      });

      await program.parseAsync(['node', 'test', 'secret', 'get', 'web/prod/api-key']);

      const tableOut = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(tableOut).not.toContain('References');
    });

    it('populates Created At / Updated At from camelCase metadata (not "-")', async () => {
      const { client } = await import('../../src/lib/client.js');
      stubMeta(client, {
        id: 'secret-1', alias: 'web/prod/api-key', tenant: 'acme',
        type: 'opaque', version: 1,
        createdBy: 'admin', createdAt: isoNow, updatedAt: isoNow,
        referencesEnabled: false, hasReferences: false,
      });

      await program.parseAsync(['node', 'test', 'secret', 'get', 'web/prod/api-key']);

      const tableOut = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      // The row exists and is not the empty-timestamp placeholder.
      expect(tableOut).toContain('Created At');
      const createdLine = tableOut.split('\n').find((l) => l.includes('Created At')) ?? '';
      expect(createdLine).not.toContain('-'.padEnd(2)); // not the bare "-" placeholder
      expect(createdLine).toContain(new Date(isoNow).getFullYear().toString());
    });
  });

  describe('secret decrypt', () => {
    it('should decrypt secret', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1']);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt', {});
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--json']);

      expect(json).toHaveBeenCalledWith(mockDecryptedSecret);
    });

    it('sends ?resolve=false with --no-resolve', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--no-resolve']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });

    it('sends no query by default (regression)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt', {});
    });

    it('decrypts a retained historical version through the dedicated route', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'secret', 'decrypt', 'secret-1', '--version', '2', '--json',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/history/2/decrypt', {});
    });

    it('rejects a non-positive or non-integer historical version', async () => {
      const { client } = await import('../../src/lib/client.js');

      await expect(program.parseAsync([
        'node', 'test', 'secret', 'decrypt', 'secret-1', '--version', '1.5',
      ])).rejects.toThrow(/exit:1/);

      expect(client.post).not.toHaveBeenCalled();
    });

    it('displays provenance (resolvedFrom and resolved) in non-JSON output', async () => {
      const { client } = await import('../../src/lib/client.js');

      const decryptedWithProvenance = {
        ...mockDecryptedSecret,
        resolvedFrom: { alias: 'db/prod/creds', field: 'password' },
        resolved: { count: 2 },
      };

      vi.mocked(client.post).mockResolvedValueOnce(decryptedWithProvenance as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resolved from: db/prod/creds#password')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resolved refs: 2')
      );
    });

    it('unwraps { value } when secret is resolved from a reference field', async () => {
      const { client } = await import('../../src/lib/client.js');

      const decryptedWithValueUnwrap = {
        id: 'secret-1',
        alias: 'web/prod/api-key',
        tenant: 'acme',
        type: 'setting',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { value: 'p@ssw0rd' },
        resolvedFrom: { alias: 'db/prod/creds', field: 'password' },
      };

      vi.mocked(client.post).mockResolvedValueOnce(decryptedWithValueUnwrap as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('p@ssw0rd')
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('"value"')
      );
    });
  });

  describe('secret decrypt --raw / --field', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let ttyDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      // Tests run piped (not a TTY); pin it so the "TTY adds a newline" rule is deterministic.
      ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    });

    afterEach(() => {
      stdoutSpy.mockRestore();
      if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
      else delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    });

    it('--raw writes only the value of a single-field secret, no metadata', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce({ ...mockSecretMetadata, data: { text: 'sk-123' } } as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw']);

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).toHaveBeenCalledWith('sk-123');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('--raw appends a newline only when stdout is a TTY', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce({ ...mockSecretMetadata, data: { text: 'sk-123' } } as never);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw']);

      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toBe('sk-123\n');
    });

    it('--field <name> prints that field and implies --raw', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce({
        ...mockSecretMetadata,
        type: 'credential',
        data: { username: 'app', password: 'p@ss' },
      } as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--field', 'password']);

      expect(stdoutSpy).toHaveBeenCalledWith('p@ss');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('--raw on a file-based secret writes the decoded bytes', async () => {
      const { client } = await import('../../src/lib/client.js');
      const content = Buffer.from('-----BEGIN KEY-----\n').toString('base64');
      vi.mocked(client.post).mockResolvedValueOnce({
        ...mockSecretMetadata,
        data: { filename: 'key.pem', content, contentType: 'application/x-pem-file' },
      } as never);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw']);

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const [arg] = stdoutSpy.mock.calls[0];
      expect(Buffer.isBuffer(arg)).toBe(true);
      expect((arg as Buffer).toString()).toBe('-----BEGIN KEY-----\n'); // no extra newline, even on TTY
    });

    it('--raw on a multi-field secret fails and names --field', async () => {
      const { error } = await import('../../src/lib/output.js');
      // default mock data has two fields: apiKey + endpoint

      await expect(
        program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw']),
      ).rejects.toThrow('exit:1');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('--field'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('apiKey, endpoint'));
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('--field with an unknown name fails and lists the available fields', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--field', 'nope']),
      ).rejects.toThrow('exit:1');

      expect(error).toHaveBeenCalledWith(expect.stringContaining("'nope'"));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('apiKey, endpoint'));
    });

    it('--raw and --json are mutually exclusive (checked before any request)', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw', '--json']),
      ).rejects.toThrow('exit:1');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('--json'));
      expect(client.post).not.toHaveBeenCalled();
    });

    it('--raw still honours --no-resolve', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce({ ...mockSecretMetadata, data: { text: '${ref:a#b}' } } as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw', '--no-resolve']);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
      expect(stdoutSpy).toHaveBeenCalledWith('${ref:a#b}');
    });

    it('--raw -o <file> writes the exact value to the file and nothing to stdout', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-raw-')), 'out.txt');
      vi.mocked(client.post).mockResolvedValueOnce({ ...mockSecretMetadata, data: { text: 'sk-123' } } as never);

      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--raw', '-o', target]);

      expect(fs.readFileSync(target, 'utf8')).toBe('sk-123');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith(expect.stringContaining(target));
    });
  });

  describe('secret delete', () => {
    it('should delete secret with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'delete', 'secret-1']);

      expect(client.delete).toHaveBeenCalledWith('/v1/secrets/secret-1');
      expect(success).toHaveBeenCalledWith('Secret deleted successfully');
    });

    it('should skip confirmation with --force flag', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'delete', 'secret-1', '--force']);

      expect(client.delete).toHaveBeenCalledWith('/v1/secrets/secret-1');
    });
  });

  describe('secret rotate', () => {
    it('should rotate secret', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'rotate', 'secret-1']);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });

    it('pre-fetch uses ?resolve=false', async () => {
      const inquirer = (await import('inquirer')).default;
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ dataJson: '{"apiKey":"x"}' } as never);
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'rotate', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });
  });

  describe('secret update', () => {
    it('sends enableReferences:true with --enable-references', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1',
        '--enable-references', '--data', '{"a":1}',
      ]);
      expect(client.put).toHaveBeenCalledWith(
        '/v1/secrets/secret-1',
        expect.objectContaining({ enableReferences: true }),
      );
    });

    it('sends enableReferences:false with --no-enable-references', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1',
        '--no-enable-references', '--data', '{"a":1}',
      ]);
      expect(client.put).toHaveBeenCalledWith(
        '/v1/secrets/secret-1',
        expect.objectContaining({ enableReferences: false }),
      );
    });

    it('omits enableReferences when neither flag is passed (sticky)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1', '--data', '{"a":1}',
      ]);
      const call = vi.mocked(client.put).mock.calls.at(-1);
      expect(call?.[1]).not.toHaveProperty('enableReferences');
    });

    it('interactive pre-fetch uses ?resolve=false', async () => {
      const inquirer = (await import('inquirer')).default;
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ updateData: false } as never);
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'update', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });
  });

  describe('secret history', () => {
    it('should show secret history', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'history', 'secret-1']);

      expect(client.get).toHaveBeenCalledWith('/v1/secrets/secret-1/history');
    });
  });

  describe('secret create', () => {
    it('reads JSON from stdin without placing the value in argv', async () => {
      mockReadStdinUtf8.mockResolvedValueOnce(
        '{"accessKey":"LAB_ACCESS","secretKey":"LAB_SECRET"}\n',
      );
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'dr/lab/c2-writer', '--data-stdin',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        alias: 'dr/lab/c2-writer',
        data: { accessKey: 'LAB_ACCESS', secretKey: 'LAB_SECRET' },
      }));
    });

    it('rejects invalid JSON received through --data-stdin', async () => {
      mockReadStdinUtf8.mockResolvedValueOnce('not-json');
      const { client } = await import('../../src/lib/client.js');

      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'dr/lab/c2-writer', '--data-stdin',
      ])).rejects.toThrow(/exit:1/);

      expect(client.post).not.toHaveBeenCalledWith('/v1/secrets', expect.anything());
    });

    it('rejects a non-object JSON value received through --data-stdin', async () => {
      mockReadStdinUtf8.mockResolvedValueOnce('["not","an","object"]');
      const { client } = await import('../../src/lib/client.js');

      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'dr/lab/c2-writer', '--data-stdin',
      ])).rejects.toThrow(/exit:1/);

      expect(client.post).not.toHaveBeenCalledWith('/v1/secrets', expect.anything());
    });

    it('rejects --data-stdin combined with another data source', async () => {
      const { client } = await import('../../src/lib/client.js');

      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'dr/lab/c2-writer',
        '--data-stdin', '--data', '{}',
      ])).rejects.toThrow(/exit:1/);

      expect(mockReadStdinUtf8).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalledWith('/v1/secrets', expect.anything());
    });

    it('builds a link secret from --link', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'api/current-key',
        '--link', 'secrets/api-key-prod',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        alias: 'api/current-key',
        type: 'setting',
        subType: 'link',
        data: { ref: 'secrets/api-key-prod' },
      }));
    });

    it('builds a field-narrowed link from --link --link-field', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'app/db-pw',
        '--link', 'db/prod/creds', '--link-field', 'password',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        subType: 'link',
        data: { ref: 'db/prod/creds', field: 'password' },
      }));
    });

    it('sends the raw ${ref:...} token verbatim with --enable-references (no expansion)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'app/url',
        '--sub-type', 'env', '--enable-references',
        '--data', '{"u":"${ref:db#password}"}',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        enableReferences: true,
        data: { u: '${ref:db#password}' },
      }));
    });

    it('rejects --link with --data', async () => {
      const { client } = await import('../../src/lib/client.js');
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--data', '{}',
      ])).rejects.toThrow(/exit:1/);
      expect(client.post).not.toHaveBeenCalledWith('/v1/secrets', expect.anything());
    });

    it('rejects --link with a conflicting --sub-type', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--sub-type', 'json',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link with an explicit non-setting --type', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--type', 'credential',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link with --suggest', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--suggest',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link-field without --link', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link-field', 'password',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects a --link alias with a leading dash', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', '-bad',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects a --link-field with a prototype-pollution segment', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--link-field', '__proto__.x',
      ])).rejects.toThrow(/exit:1/);
    });
  });

  describe('secret protection', () => {
    const converted = {
      id: 'secret-1',
      previousMode: 'STANDARD',
      protectionMode: 'USER_SESSION_ONLY',
      historyMode: 'PRESERVE_HISTORY',
      versionsConverted: 3,
      historyVersionsDeleted: 0,
      grantCount: 1,
      rootRecoveryWrapped: false,
    };

    it('preserves history by default when converting to User-Sealed', async () => {
      const {client} = await import('../../src/lib/client.js');
      const {promptConfirm} = await import('../../src/lib/prompts.js');
      vi.mocked(client.post).mockResolvedValueOnce(converted as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'protection', 'web/prod/api-key',
        '--protection', 'user-session', '--grant-user', 'user-1',
      ]);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/protection-mode', {
        targetMode: 'USER_SESSION_ONLY',
        historyMode: 'PRESERVE_HISTORY',
        grantUserIds: ['user-1'],
      });
    });

    it('requires both confirmations for a destructive conversion to Standard', async () => {
      const {client} = await import('../../src/lib/client.js');
      const {promptConfirm} = await import('../../src/lib/prompts.js');
      vi.mocked(promptConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      vi.mocked(client.post).mockResolvedValueOnce({
        ...converted,
        previousMode: 'USER_SESSION_ONLY',
        protectionMode: 'STANDARD',
        historyMode: 'DELETE_HISTORY',
        versionsConverted: 1,
        historyVersionsDeleted: 2,
        grantCount: 0,
      } as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'protection', 'secret-1',
        '--protection', 'standard', '--history', 'delete', '--root-recovery',
      ]);

      expect(promptConfirm).toHaveBeenNthCalledWith(
        1,
        'Permanently delete every retained version before converting this secret?',
        false,
      );
      expect(promptConfirm).toHaveBeenNthCalledWith(
        2,
        'Convert to Standard and allow API keys/service accounts to decrypt when normal permissions permit?',
        false,
      );
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/protection-mode', {
        targetMode: 'STANDARD',
        historyMode: 'DELETE_HISTORY',
        confirmHistoryDeletion: true,
        confirmStandardExposure: true,
        useRootRecovery: true,
      });
    });

    it('cancels before resolving or mutating when history deletion is refused', async () => {
      const {client} = await import('../../src/lib/client.js');
      const {promptConfirm} = await import('../../src/lib/prompts.js');
      vi.mocked(promptConfirm).mockResolvedValueOnce(false);

      await program.parseAsync([
        'node', 'test', 'secret', 'protection', 'web/prod/api-key',
        '--protection', 'user-session', '--history', 'delete',
      ]);

      expect(client.get).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('uses --yes for both server confirmations without prompting', async () => {
      const {client} = await import('../../src/lib/client.js');
      const {promptConfirm} = await import('../../src/lib/prompts.js');
      vi.mocked(client.post).mockResolvedValueOnce(converted as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'protection', 'secret-1',
        '--protection', 'standard', '--history', 'delete', '--yes',
      ]);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/protection-mode', {
        targetMode: 'STANDARD',
        historyMode: 'DELETE_HISTORY',
        confirmHistoryDeletion: true,
        confirmStandardExposure: true,
      });
    });
  });

  describe('secret can-decrypt', () => {
    const allowedVerdict = {
      verdict: 'allowed',
      simulatedIdentity: { kind: 'self', id: null },
      secret: { id: 'secret-1', alias: 'web/prod/api-key', subType: undefined, hasReferences: false },
      self: { verdict: 'allowed', conditionalOn: [] },
      targets: [],
      firstDenial: null,
    };

    it('posts {} for a self-check (neither --as-* flag)', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce(allowedVerdict as never);

      await program.parseAsync(['node', 'test', 'secret', 'can-decrypt', 'secret-1']);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/can-decrypt', {});
    });

    it('posts {asApiKeyId} for --as-api-key', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce(allowedVerdict as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'can-decrypt', 'secret-1', '--as-api-key', 'ak_123',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/can-decrypt', {
        asApiKeyId: 'ak_123',
      });
    });

    it('posts {asUserId} for --as-user', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce(allowedVerdict as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'can-decrypt', 'secret-1', '--as-user', 'user-42',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/can-decrypt', {
        asUserId: 'user-42',
      });
    });

    it('rejects --as-api-key together with --as-user (exit 1, no POST)', async () => {
      const { client } = await import('../../src/lib/client.js');

      await expect(program.parseAsync([
        'node', 'test', 'secret', 'can-decrypt', 'secret-1',
        '--as-api-key', 'ak_123', '--as-user', 'user-42',
      ])).rejects.toThrow(/exit:1/);

      expect(client.post).not.toHaveBeenCalled();
    });

    it('renders each verdict class (allowed/conditional/denied/indeterminate) in plain output', async () => {
      const { client } = await import('../../src/lib/client.js');
      vi.mocked(client.post).mockResolvedValueOnce({
        verdict: 'conditional',
        simulatedIdentity: { kind: 'apikey', id: 'ak_123' },
        secret: { id: 'secret-1', alias: 'api/staging/config', subType: undefined, hasReferences: true },
        self: { verdict: 'allowed', conditionalOn: [] },
        targets: [
          { alias: 'db/prod/creds', verdict: 'conditional', conditionalOn: ['ip'], reason: 'ABAC requires source IP in 10.0.0.0/8' },
          { alias: 'cache/redis', verdict: 'denied', reason: 'identity lacks secret:read:value' },
          { alias: null, verdict: 'indeterminate', reason: 'reference_unresolvable' },
        ],
        firstDenial: { alias: 'cache/redis', reason: 'identity lacks secret:read:value' },
      } as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'can-decrypt', 'secret-1', '--as-api-key', 'ak_123',
      ]);

      const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('secret');
      expect(printed).toContain('ALLOWED');
      expect(printed).toContain('ref db/prod/creds');
      expect(printed).toContain('CONDITIONAL');
      expect(printed).toContain('ABAC requires source IP in 10.0.0.0/8');
      expect(printed).toContain('ref cache/redis');
      expect(printed).toContain('DENIED');
      expect(printed).toContain('identity lacks secret:read:value');
      expect(printed).toContain('ref <hidden>');
      expect(printed).toContain('INDETERMINATE');
      expect(printed).toContain('not visible to you');
      expect(printed).toContain('Verdict: CONDITIONAL');
    });

    it('passes the raw verdict through with --json', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');
      vi.mocked(client.post).mockResolvedValueOnce(allowedVerdict as never);

      await program.parseAsync([
        'node', 'test', 'secret', 'can-decrypt', 'secret-1', '--json',
      ]);

      expect(json).toHaveBeenCalledWith(allowedVerdict);
    });
  });
});
