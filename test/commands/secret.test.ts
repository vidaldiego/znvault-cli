// Path: znvault-cli/test/commands/secret.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

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
      if (path.includes('/v1/secrets?')) return Promise.resolve(mockSecrets);
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
    delete: vi.fn().mockResolvedValue(undefined),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  json: vi.fn(),
}));

describe('secret commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret.js');
    registerSecretCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
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

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'list', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('tenant=acme'));
    });

    it('should filter by type', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'list', '--type', 'credential']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('type=credential'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'secret', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockSecrets);
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

  describe('secret history', () => {
    it('should show secret history', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'secret', 'history', 'secret-1']);

      expect(client.get).toHaveBeenCalledWith('/v1/secrets/secret-1/history');
    });
  });
});
