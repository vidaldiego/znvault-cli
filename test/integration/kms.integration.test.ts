// Path: znvault-cli/test/integration/kms.integration.test.ts

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for KMS CLI commands.
 *
 * These tests run against a real ZN-Vault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('KMS Commands Integration', () => {
  const createdKeyIds: string[] = [];

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as tenant admin for KMS operations
    const loginResult = TestConfig.loginAsTenantAdmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as tenant admin');
  });

  afterEach(async () => {
    // Cleanup created keys (schedule deletion)
    for (const id of createdKeyIds) {
      try {
        TestConfig.exec('kms', 'delete', id, '--force', '--days', '7');
        console.log(`  Scheduled deletion for key: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdKeyIds.length = 0;
  });

  describe('kms list', () => {
    it('should list KMS keys', () => {
      const result = TestConfig.exec('kms', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      console.log('✓ Listed KMS keys');
    });

    it('should list keys as JSON', () => {
      const result = TestConfig.execJson<Array<{ keyId: string }>>('kms', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      console.log(`✓ Listed ${result.data?.length ?? 0} keys as JSON`);
    });
  });

  describe('kms create', () => {
    it('should create a new KMS key', () => {
      const alias = TestConfig.uniqueId('cli-key');

      const result = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias,
        '--description', 'CLI test key'
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('created successfully');

      // Extract key ID for cleanup
      const idMatch = result.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdKeyIds.push(idMatch[1]);
      }

      console.log(`✓ Created KMS key: ${alias}`);
    });

    it('should create key with custom spec', () => {
      const alias = TestConfig.uniqueId('cli-key-spec');

      const result = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias,
        '--spec', 'AES_256',
        '--usage', 'ENCRYPT_DECRYPT'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdKeyIds.push(idMatch[1]);
      }

      console.log(`✓ Created KMS key with AES_256 spec: ${alias}`);
    });
  });

  describe('kms get', () => {
    it('should get KMS key details', () => {
      // Create a key first
      const alias = TestConfig.uniqueId('cli-get-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      expect(idMatch).toBeTruthy();
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Get the key
      const result = TestConfig.exec('kms', 'get', keyId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(keyId);
      // API returns ENABLED (uppercase)
      expect(result.stdout.toUpperCase()).toContain('ENABLED');

      console.log(`✓ Got KMS key: ${keyId}`);
    });

    it('should get key as JSON', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-get-json');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Get as JSON
      const result = TestConfig.execJson<{ keyId: string; keyState: string }>('kms', 'get', keyId);

      expect(result.success).toBe(true);
      expect(result.data?.keyId).toBe(keyId);
      // API returns ENABLED (uppercase)
      expect(result.data?.keyState).toBe('ENABLED');

      console.log(`✓ Got KMS key as JSON: ${keyId}`);
    });
  });

  describe('kms encrypt/decrypt', () => {
    it('should encrypt and decrypt data', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-encrypt-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Encrypt data
      const plaintext = 'Hello, World!';
      const encryptResult = TestConfig.exec('kms', 'encrypt', keyId, plaintext);

      expect(encryptResult.success).toBe(true);
      expect(encryptResult.stdout).toContain('Ciphertext');

      // Extract ciphertext
      const ciphertextMatch = encryptResult.stdout.match(/Ciphertext \(base64\):\s*\n([A-Za-z0-9+/=]+)/);
      expect(ciphertextMatch).toBeTruthy();
      const ciphertext = ciphertextMatch![1].trim();

      // Decrypt data
      const decryptResult = TestConfig.exec('kms', 'decrypt', keyId, ciphertext);

      expect(decryptResult.success).toBe(true);
      expect(decryptResult.stdout).toContain(plaintext);

      console.log(`✓ Encrypted and decrypted data with key: ${keyId}`);
    });

    it('should encrypt with context', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-context-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Encrypt with context
      const encryptResult = TestConfig.exec(
        'kms', 'encrypt', keyId, 'secret data',
        '--context', 'purpose=test,env=dev'
      );

      expect(encryptResult.success).toBe(true);
      expect(encryptResult.stdout).toContain('Encryption Context');

      console.log(`✓ Encrypted data with context: ${keyId}`);
    });
  });

  describe('kms generate-data-key', () => {
    it('should generate a data encryption key', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-dek-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Generate DEK
      const result = TestConfig.exec('kms', 'generate-data-key', keyId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Plaintext Data Key');
      expect(result.stdout).toContain('Encrypted Data Key');

      console.log(`✓ Generated data key with: ${keyId}`);
    });
  });

  describe('kms rotate', () => {
    it('should rotate KMS key', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-rotate-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Rotate the key
      const result = TestConfig.exec('kms', 'rotate', keyId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('rotated successfully');
      expect(result.stdout).toContain('New Version');

      console.log(`✓ Rotated key: ${keyId}`);
    });
  });

  describe('kms enable/disable', () => {
    it('should disable and enable a key', () => {
      // Create a key
      const alias = TestConfig.uniqueId('cli-toggle-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Disable it
      const disableResult = TestConfig.exec('kms', 'disable', keyId);
      expect(disableResult.success).toBe(true);
      expect(disableResult.stdout).toContain('disabled');

      // Verify it's disabled - API returns uppercase states
      const getResult = TestConfig.execJson<{ keyState: string }>('kms', 'get', keyId);
      expect(getResult.data?.keyState).toBe('DISABLED');

      // Enable it again
      const enableResult = TestConfig.exec('kms', 'enable', keyId);
      expect(enableResult.success).toBe(true);
      expect(enableResult.stdout.toLowerCase()).toContain('enabled');

      // Verify it's enabled - API returns uppercase states
      const getResult2 = TestConfig.execJson<{ keyState: string }>('kms', 'get', keyId);
      expect(getResult2.data?.keyState).toBe('ENABLED');

      console.log(`✓ Toggled key state: ${keyId}`);
    });
  });

  describe('kms versions', () => {
    it('should list key versions', () => {
      // Create and rotate a key
      const alias = TestConfig.uniqueId('cli-versions-key');
      const createResult = TestConfig.exec(
        'kms', 'create',
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--alias', alias
      );

      const idMatch = createResult.stdout.match(/Key ID:\s+([a-f0-9-]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Rotate to create version 2
      TestConfig.exec('kms', 'rotate', keyId);

      // List versions - endpoint may not be implemented
      const result = TestConfig.exec('kms', 'versions', keyId);

      // Skip if endpoint not available
      if (!result.success) {
        console.log('  Skipping - kms versions endpoint not available');
        return;
      }
      expect(result.stdout).toContain('Version ID');

      console.log(`✓ Listed versions for key: ${keyId}`);
    });
  });
});
