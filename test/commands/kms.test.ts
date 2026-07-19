// Path: znvault-cli/test/commands/kms.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock dependencies
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

// A signing key whose spec admits exactly one algorithm -- the "infer it" case.
const mockPublicKeyResponse = {
  keyId: 'key-001',
  keyVersion: 1,
  keySpec: 'ECC_ED25519',
  keyUsage: 'SIGN_VERIFY',
  publicKey: 'cHVibGljS2V5QmFzZTY0',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----',
  signingAlgorithms: ['ED25519_SHA_512'],
};

// An RSA signing key whose spec admits multiple algorithms -- --algorithm is required.
const mockRsaPublicKeyResponse = {
  keyId: 'key-rsa',
  keyVersion: 1,
  keySpec: 'RSA_2048',
  keyUsage: 'SIGN_VERIFY',
  publicKey: 'cnNhUHVibGljS2V5',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----',
  signingAlgorithms: [
    'RSASSA_PKCS1_V1_5_SHA_256',
    'RSASSA_PKCS1_V1_5_SHA_384',
    'RSASSA_PKCS1_V1_5_SHA_512',
    'RSASSA_PSS_SHA_256',
    'RSASSA_PSS_SHA_384',
    'RSASSA_PSS_SHA_512',
  ],
};

const mockSignResponse = {
  keyId: 'key-001',
  keyVersion: 1,
  signature: 'c2lnbmF0dXJlYnl0ZXM=',
  signingAlgorithm: 'ED25519_SHA_512',
};

const mockVerifyValidResponse = { keyId: 'key-001', signatureValid: true, signingAlgorithm: 'ED25519_SHA_512' };
const mockVerifyInvalidResponse = { keyId: 'key-001', signatureValid: false, signingAlgorithm: 'ED25519_SHA_512' };

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => {
      // List path: matches both /v1/kms/keys and the admin variant
      // /v1/superadmin/kms/keys (with or without a trailing query string).
      if (/^\/v1\/(superadmin\/)?kms\/keys(\?|$)/.test(path)) {
        return Promise.resolve({ items: mockKeys, pagination: { total: 2, page: 1, pageSize: 20, totalPages: 1 } });
      }
      if (path.includes('/versions')) return Promise.resolve(mockVersions);
      if (path.includes('/public-key')) return Promise.resolve(mockPublicKeyResponse);
      // API returns { keyMetadata: { ... } }
      if (path.includes('/kms/keys/')) return Promise.resolve({ keyMetadata: mockKeyDetails });
      return Promise.resolve({ keyMetadata: mockKeyDetails });
    }),
    post: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/encrypt')) return Promise.resolve(mockEncryptResponse);
      if (path.includes('/decrypt')) return Promise.resolve(mockDecryptResponse);
      if (path.includes('/generate-data-key')) return Promise.resolve(mockDataKeyResponse);
      if (path.includes('/kms/sign')) return Promise.resolve(mockSignResponse);
      if (path.includes('/kms/verify')) return Promise.resolve(mockVerifyValidResponse);
      if (path.includes('/rotate')) return Promise.resolve({ keyId: 'key-001', newVersionId: 'v3', message: 'Rotated' });
      if (path.includes('/enable')) return Promise.resolve({});
      if (path.includes('/disable')) return Promise.resolve({});
      return Promise.resolve(mockKeyDetails);
    }),
    patch: vi.fn().mockImplementation((path: string, body: unknown) => {
      if (path.includes('/prehash')) {
        const enabled = (body as { enabled?: boolean } | undefined)?.enabled ?? false;
        return Promise.resolve({ keyId: 'key-001', prehashAllowed: enabled });
      }
      return Promise.resolve(mockKeyDetails);
    }),
    delete: vi.fn().mockResolvedValue({ keyId: 'key-001', deletionDate: new Date().toISOString(), message: 'Scheduled' }),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
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
}));

describe('kms commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerKmsCommands } = await import('../../src/commands/kms/index.js');
    registerKmsCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // sign/verify/public-key call process.exit() directly (not via commander's
    // exitOverride), including on success (verify exits 0/1 by design) -- mock
    // it so tests never actually terminate the vitest process.
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      // `kms verify`'s success path calls process.exit(0) as the LAST
      // statement inside its own try block. If we throw there too (as we do
      // for every other exit call, to emulate exit's real never-returns
      // semantics), that synthetic throw gets swallowed by the surrounding
      // catch and turns into a spurious process.exit(1) -- so let 0 no-op
      // instead of throwing.
      if (code === 0) return undefined as never;
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    mockExit.mockRestore();
    vi.clearAllMocks();
  });

  describe('kms list', () => {
    it('should list all KMS keys', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'list']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/v1/kms/keys'));
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'list', '--tenant', 'acme']);

      // --tenant for a non-tenant principal routes via the superadmin surface
      // (server v1.39.0+).
      const calledWith = (client.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledWith).toContain('/v1/superadmin/kms/keys');
      expect(calledWith).toContain('tenantId=acme');
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

      // --tenant routes via /v1/superadmin/kms/keys with tenantId as a query
      // parameter; the body no longer carries `tenant`.
      expect(client.post).toHaveBeenCalledWith(
        expect.stringMatching(/^\/v1\/superadmin\/kms\/keys\?.*tenantId=acme/),
        expect.objectContaining({ alias: 'alias/my-key' })
      );
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

      expect(client.post).toHaveBeenCalledWith(
        expect.stringMatching(/^\/v1\/superadmin\/kms\/keys\?.*tenantId=acme/),
        expect.objectContaining({
          description: 'A test key',
          tags: [{ key: 'env', value: 'prod' }, { key: 'team', value: 'backend' }],
        })
      );
    });
  });

  describe('alias key identifiers (must be URL-encoded as one path segment)', () => {
    // An alias is stored as `alias/<name>`; interpolating it raw produces
    // /v1/kms/keys/alias/foo/public-key, which does not match the server's
    // single-segment :keyId route (404). encodeURIComponent fixes it:
    // /v1/kms/keys/alias%2Ffoo/public-key -> param decodes back to alias/foo.
    it('public-key encodes an alias keyId', async () => {
      const { client } = await import('../../src/lib/client.js');

      // public-key exits the process on its success path; swallow that so the
      // assertion below is what decides the test.
      try {
        await program.parseAsync(['node', 'test', 'kms', 'public-key', 'alias/foo']);
      } catch {
        /* process.exit mock throws — irrelevant here */
      }

      expect(client.get).toHaveBeenCalledWith('/v1/kms/keys/alias%2Ffoo/public-key');
    });

    it('get encodes an alias keyId', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'get', 'alias/foo']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('alias%2Ffoo'));
    });

    it('prehash enable encodes an alias keyId', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'prehash', 'enable', 'alias/foo']);

      expect(client.patch).toHaveBeenCalledWith('/v1/kms/keys/alias%2Ffoo/prehash', { enabled: true });
    });

    it('leaves a plain UUID keyId unchanged', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'get', 'key-001']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/kms/keys/key-001'));
    });
  });

  describe('kms prehash (arming)', () => {
    it('enable should PATCH the tenant prehash route with enabled:true', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'prehash', 'enable', 'key-001']);

      expect(client.patch).toHaveBeenCalledWith('/v1/kms/keys/key-001/prehash', { enabled: true });
    });

    it('disable should PATCH the tenant prehash route with enabled:false', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'kms', 'prehash', 'disable', 'key-001']);

      expect(client.patch).toHaveBeenCalledWith('/v1/kms/keys/key-001/prehash', { enabled: false });
    });
  });

  describe('kms create --prehash-allowed', () => {
    it('threads prehashAllowed:true for an RSA SIGN_VERIFY key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'kms', 'create',
        '--tenant', 'acme', '--usage', 'SIGN_VERIFY', '--spec', 'RSA_2048', '--prehash-allowed',
      ]);

      expect(client.post).toHaveBeenCalledWith(
        expect.stringContaining('kms/keys'),
        expect.objectContaining({ usage: 'SIGN_VERIFY', keySpec: 'RSA_2048', prehashAllowed: true })
      );
    });

    it('rejects --prehash-allowed on a non-RSA / non-SIGN_VERIFY key before any request', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'kms', 'create', '--tenant', 'acme', '--prehash-allowed'])
      ).rejects.toThrow(/process\.exit\(1\)/);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('--prehash-allowed requires'));
      expect(client.post).not.toHaveBeenCalled();
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

  describe('kms sign', () => {
    it('base64-encodes the message and prints the base64 signature to stdout', async () => {
      const { client } = await import('../../src/lib/client.js');
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await program.parseAsync([
        'node', 'test', 'kms', 'sign', 'key-001', 'hello world',
        '--algorithm', 'ED25519_SHA_512',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/sign', {
        keyId: 'key-001',
        message: Buffer.from('hello world').toString('base64'),
        signingAlgorithm: 'ED25519_SHA_512',
      });
      expect(stdoutSpy).toHaveBeenCalledWith(`${mockSignResponse.signature}\n`);

      stdoutSpy.mockRestore();
    });

    it('writes the base64 signature to a file with --output', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-sign-'));
      const outFile = path.join(dir, 'out.sig');

      try {
        await program.parseAsync([
          'node', 'test', 'kms', 'sign', 'key-001', 'hello world',
          '--algorithm', 'ED25519_SHA_512', '--output', outFile,
        ]);

        expect(client.post).toHaveBeenCalledWith('/v1/kms/sign', expect.objectContaining({ keyId: 'key-001' }));
        expect(fs.readFileSync(outFile, 'utf8')).toBe(mockSignResponse.signature);
        expect(success).toHaveBeenCalledWith(expect.stringContaining(outFile));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveAlgorithm (via kms sign/verify inference)', () => {
    it('infers the algorithm when the key admits exactly one', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { resolveAlgorithm } = await import('../../src/commands/kms/helpers.js');

      const algorithm = await resolveAlgorithm('key-001');

      expect(client.get).toHaveBeenCalledWith('/v1/kms/keys/key-001/public-key');
      expect(algorithm).toBe('ED25519_SHA_512');
    });

    it('errors listing the choices when the key admits multiple algorithms, without picking one', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');
      const { resolveAlgorithm } = await import('../../src/commands/kms/helpers.js');

      vi.mocked(client.get).mockResolvedValueOnce(mockRsaPublicKeyResponse);

      await expect(resolveAlgorithm('key-rsa')).rejects.toThrow('process.exit(1)');

      const message = vi.mocked(error).mock.calls[0][0];
      expect(message).toContain('--algorithm is required');
      for (const alg of mockRsaPublicKeyResponse.signingAlgorithms) {
        expect(message).toContain(alg);
      }
    });

    it('uses an explicit --algorithm without fetching the key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { resolveAlgorithm } = await import('../../src/commands/kms/helpers.js');

      const algorithm = await resolveAlgorithm('key-001', 'RSASSA_PSS_SHA_256');

      expect(algorithm).toBe('RSASSA_PSS_SHA_256');
      expect(client.get).not.toHaveBeenCalled();
    });
  });

  describe('readMessage (--file / positional-message mutual exclusivity)', () => {
    it('errors when both a message and --file are given', async () => {
      const { error } = await import('../../src/lib/output.js');
      const { readMessage } = await import('../../src/commands/kms/helpers.js');

      await expect(readMessage('inline message', '/tmp/whatever.bin')).rejects.toThrow('process.exit(1)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('either a message argument or --file'));
    });

    it('errors when neither a message nor --file is given', async () => {
      const { error } = await import('../../src/lib/output.js');
      const { readMessage } = await import('../../src/commands/kms/helpers.js');

      await expect(readMessage(undefined, undefined)).rejects.toThrow('process.exit(1)');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('No message given'));
    });

    it('reads the message bytes from --file when given alone', async () => {
      const { readMessage } = await import('../../src/commands/kms/helpers.js');

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-msg-'));
      const file = path.join(dir, 'message.txt');
      fs.writeFileSync(file, 'file contents');

      try {
        const bytes = await readMessage(undefined, file);
        expect(bytes.toString('utf8')).toBe('file contents');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns the positional message bytes when given alone', async () => {
      const { readMessage } = await import('../../src/commands/kms/helpers.js');

      const bytes = await readMessage('hello', undefined);

      expect(bytes.toString('utf8')).toBe('hello');
    });
  });

  describe('kms verify', () => {
    it('exits 0 for a VALID signature via the normal result path', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'kms', 'verify', 'key-001', 'hello world',
        '--algorithm', 'ED25519_SHA_512', '--signature', 'c2lnbmF0dXJl',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/kms/verify', {
        keyId: 'key-001',
        message: Buffer.from('hello world').toString('base64'),
        signature: 'c2lnbmF0dXJl',
        signingAlgorithm: 'ED25519_SHA_512',
      });
      expect(success).toHaveBeenCalledWith(expect.stringContaining('VALID'));
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('exits non-zero for an INVALID signature via the normal result path, not the catch/transport-error path', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');

      // The request itself succeeds (resolves, doesn't throw) -- it's the
      // verdict inside the response body that is false. This is what must be
      // distinguished from a transport/request failure below.
      vi.mocked(client.post).mockResolvedValueOnce(mockVerifyInvalidResponse);

      await expect(program.parseAsync([
        'node', 'test', 'kms', 'verify', 'key-001', 'hello world',
        '--algorithm', 'ED25519_SHA_512', '--signature', 'c2lnbmF0dXJl',
      ])).rejects.toThrow('process.exit(1)');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('INVALID'));
      // The catch block's message is different ("Verification request failed" +
      // the thrown error's message) -- assert we did NOT go down that path.
      expect(error).not.toHaveBeenCalledWith(expect.stringContaining('request failed'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('errors when no --signature or --signature-file is given', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(program.parseAsync([
        'node', 'test', 'kms', 'verify', 'key-001', 'hello world', '--algorithm', 'ED25519_SHA_512',
      ])).rejects.toThrow('process.exit(1)');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('No signature given'));
    });
  });

  describe('kms public-key', () => {
    it('returns the PEM public key with --pem', async () => {
      const { client } = await import('../../src/lib/client.js');
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await program.parseAsync(['node', 'test', 'kms', 'public-key', 'key-001', '--pem']);

      expect(client.get).toHaveBeenCalledWith('/v1/kms/keys/key-001/public-key');
      expect(stdoutSpy).toHaveBeenCalledWith(`${mockPublicKeyResponse.publicKeyPem}\n`);

      stdoutSpy.mockRestore();
    });

    it('returns the base64 SPKI DER public key by default', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await program.parseAsync(['node', 'test', 'kms', 'public-key', 'key-001']);

      expect(stdoutSpy).toHaveBeenCalledWith(`${mockPublicKeyResponse.publicKey}\n`);

      stdoutSpy.mockRestore();
    });
  });
});
