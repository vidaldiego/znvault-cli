// Path: znvault-cli/test/commands/secret.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

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
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/v1/secrets?')) return Promise.resolve({ items: mockSecrets, pagination: { total: 2, page: 1, pageSize: 20, totalPages: 1 } });
      if (path.includes('/meta')) return Promise.resolve(mockSecretMetadata);
      if (path.includes('/history')) return Promise.resolve([{ version: 1, createdAt: new Date().toISOString() }]);
      return Promise.resolve(mockSecretMetadata);
    }),
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
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
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

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
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

      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt', {});
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
});
