// Path: znvault-cli/test/commands/kms.test.ts

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
    prompt: vi.fn().mockResolvedValue({ confirm: true, inputData: 'test data', inputCiphertext: 'Y2lwaGVydGV4dA==' }),
  },
}));

const mockKeys = [
  {
    keyId: 'key-001',
    alias: 'alias/prod-key',
    keyState: 'Enabled',
    createdDate: new Date().toISOString(),
  },
  {
    keyId: 'key-002',
    alias: 'alias/dev-key',
    keyState: 'Disabled',
    createdDate: new Date().toISOString(),
  },
];

const mockKeyDetails = {
  keyId: 'key-001',
  alias: 'alias/prod-key',
  arn: 'arn:znvault:kms:key-001',
  keyState: 'Enabled',
  keyUsage: 'ENCRYPT_DECRYPT',
  keySpec: 'AES_256',
  description: 'Production encryption key',
  tenant: 'acme',
  createdDate: new Date().toISOString(),
  currentVersionId: 'v1',
  rotationEnabled: true,
};

const mockEncryptResponse = {
  keyId: 'key-001',
  ciphertext: 'ZW5jcnlwdGVkZGF0YQ==',
  encryptionContext: { purpose: 'test' },
};

const mockDecryptResponse = {
  keyId: 'key-001',
  plaintext: 'dGVzdCBkYXRh', // 'test data' in base64
  encryptionContext: { purpose: 'test' },
};

const mockDataKeyResponse = {
  keyId: 'key-001',
  plaintext: 'cGxhaW50ZXh0a2V5',
  ciphertext: 'ZW5jcnlwdGVka2V5',
};

const mockVersions = [
  { versionId: 'v2', createdAt: new Date().toISOString(), isCurrentVersion: true },
  { versionId: 'v1', createdAt: new Date().toISOString(), isCurrentVersion: false },
];

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/v1/kms/keys?')) return Promise.resolve({ keys: mockKeys, truncated: false });
      if (path.includes('/versions')) return Promise.resolve(mockVersions);
      // API returns { keyMetadata: { ... } }
      if (path.includes('/v1/kms/keys/')) return Promise.resolve({ keyMetadata: mockKeyDetails });
      return Promise.resolve({ keyMetadata: mockKeyDetails });
    }),
    post: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/encrypt')) return Promise.resolve(mockEncryptResponse);
      if (path.includes('/decrypt')) return Promise.resolve(mockDecryptResponse);
      if (path.includes('/generate-data-key')) return Promise.resolve(mockDataKeyResponse);
      if (path.includes('/rotate')) return Promise.resolve({ keyId: 'key-001', newVersionId: 'v3', message: 'Rotated' });
      if (path.includes('/enable')) return Promise.resolve({});
      if (path.includes('/disable')) return Promise.resolve({});
      return Promise.resolve(mockKeyDetails);
    }),
    patch: vi.fn().mockResolvedValue(mockKeyDetails),
    delete: vi.fn().mockResolvedValue({ keyId: 'key-001', deletionDate: new Date().toISOString(), message: 'Scheduled' }),
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

describe('kms commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerKmsCommands } = await import('../../src/commands/kms.js');
    registerKmsCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('kms list', () => {
    it('should list all KMS keys', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'list']);

      expect(client.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('2 key(s)'));
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'list', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('tenant=acme'));
    });

    it('should filter by state', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'list', '--state', 'Enabled']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('state=Enabled'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockKeys);
    });
  });

  describe('kms get', () => {
    it('should get KMS key details', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'get', 'key-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/kms/keys/key-001');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'get', 'key-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockKeyDetails);
    });
  });

  describe('kms create', () => {
    it('should create a new KMS key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'create', '--tenant', 'acme', '--alias', 'my-key']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/keys', expect.objectContaining({
        tenant: 'acme',
        alias: 'alias/my-key',
      }));
      expect(success).toHaveBeenCalledWith('KMS key created successfully!');
    });

    it('should create key with description and tags', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'kms', 'create',
        '--tenant', 'acme',
        '--alias', 'tagged-key',
        '--description', 'A test key',
        '--tags', 'env=prod,team=backend',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/keys', expect.objectContaining({
        tenant: 'acme',
        description: 'A test key',
        tags: [{ key: 'env', value: 'prod' }, { key: 'team', value: 'backend' }],
      }));
    });
  });

  describe('kms encrypt', () => {
    it('should encrypt data with key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'encrypt', 'key-001', 'test data']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/encrypt', expect.objectContaining({
        keyId: 'key-001',
        plaintext: Buffer.from('test data').toString('base64'),
      }));
    });

    it('should include encryption context', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'kms', 'encrypt', 'key-001', 'test data',
        '--context', 'purpose=test',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/encrypt', expect.objectContaining({
        context: { purpose: 'test' },
      }));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'encrypt', 'key-001', 'test data', '--json']);

      expect(json).toHaveBeenCalledWith(mockEncryptResponse);
    });
  });

  describe('kms decrypt', () => {
    it('should decrypt ciphertext with key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'decrypt', 'key-001', 'Y2lwaGVydGV4dA==']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/decrypt', expect.objectContaining({
        keyId: 'key-001',
        ciphertext: 'Y2lwaGVydGV4dA==',
      }));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'decrypt', 'key-001', 'Y2lwaGVydGV4dA==', '--json']);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({
        keyId: 'key-001',
      }));
    });
  });

  describe('kms generate-data-key', () => {
    it('should generate data encryption key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'generate-data-key', 'key-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/generate-data-key', expect.objectContaining({
        keyId: 'key-001',
        keySpec: 'AES_256',
      }));
    });

    it('should use custom key spec', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'generate-data-key', 'key-001', '--spec', 'AES_128']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/generate-data-key', expect.objectContaining({
        keySpec: 'AES_128',
      }));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'generate-data-key', 'key-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockDataKeyResponse);
    });
  });

  describe('kms rotate', () => {
    it('should rotate key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'rotate', 'key-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/keys/key-001/rotate', {});
      expect(success).toHaveBeenCalledWith('Key rotated successfully!');
    });
  });

  describe('kms delete', () => {
    it('should delete key with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'delete', 'key-001']);

      expect(client.delete).toHaveBeenCalledWith(expect.stringContaining('/v1/kms/keys/key-001'));
      expect(success).toHaveBeenCalledWith('Key deletion scheduled');
    });

    it('should skip confirmation with --force flag', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'delete', 'key-001', '--force']);

      expect(client.delete).toHaveBeenCalled();
    });

    it('should use custom waiting period', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'delete', 'key-001', '--force', '--days', '7']);

      expect(client.delete).toHaveBeenCalledWith('/v1/kms/keys/key-001?pendingWindowInDays=7');
    });
  });

  describe('kms enable', () => {
    it('should enable a disabled key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'enable', 'key-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/keys/key-001/enable', {});
      expect(success).toHaveBeenCalledWith('Key key-001 enabled');
    });
  });

  describe('kms disable', () => {
    it('should disable an enabled key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'disable', 'key-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/keys/key-001/disable', {});
      expect(success).toHaveBeenCalledWith('Key key-001 disabled');
    });
  });

  describe('kms versions', () => {
    it('should list key versions', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'versions', 'key-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/kms/keys/key-001/versions');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'kms', 'versions', 'key-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockVersions);
    });
  });
});
