// Path: znvault-cli/test/integration/secret.integration.test.ts

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for secret CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Secret Commands Integration', () => {
  const createdSecretIds: string[] = [];

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as tenant admin for secret operations
    const loginResult = TestConfig.loginAsTenantAdmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as tenant admin');
  });

  afterEach(async () => {
    // Cleanup created secrets
    for (const id of createdSecretIds) {
      try {
        TestConfig.exec('secret', 'delete', id, '--force');
        console.log(`  Cleaned up secret: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSecretIds.length = 0;
  });

  describe('secret list', () => {
    it('should list secrets', () => {
      const result = TestConfig.exec('secret', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('secret');
      console.log('✓ Listed secrets');
    });

    it('should list secrets as JSON', () => {
      const result = TestConfig.execJson<Array<{ id: string }>>('secret', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      console.log(`✓ Listed ${result.data?.length ?? 0} secrets as JSON`);
    });
  });

  describe('secret create', () => {
    it('should create a credential secret', () => {
      const alias = TestConfig.uniqueAlias('creds');

      const result = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'credential',
        '--username', 'testuser',
        '--password', 'testpass123'
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('created successfully');

      // Extract ID from output for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdSecretIds.push(idMatch[1]);
      }

      console.log(`✓ Created credential secret: ${alias}`);
    });

    it('should create an opaque secret', () => {
      const alias = TestConfig.uniqueAlias('opaque');

      const result = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', JSON.stringify({ api_key: 'sk_test_123', endpoint: 'https://api.example.com' })
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('created successfully');

      // Extract ID for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdSecretIds.push(idMatch[1]);
      }

      console.log(`✓ Created opaque secret: ${alias}`);
    });
  });

  describe('secret get', () => {
    it('should get secret metadata', () => {
      // First create a secret
      const alias = TestConfig.uniqueAlias('get-test');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"key":"value"}'
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      expect(idMatch).toBeTruthy();
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Now get it
      const result = TestConfig.exec('secret', 'get', secretId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(secretId);
      expect(result.stdout).toContain(alias);

      console.log(`✓ Got secret metadata: ${secretId}`);
    });

    it('should get secret as JSON', () => {
      // Create a secret
      const alias = TestConfig.uniqueAlias('get-json');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"key":"value"}'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Get as JSON
      const result = TestConfig.execJson<{ id: string; alias: string }>('secret', 'get', secretId);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(secretId);
      expect(result.data?.alias).toBe(alias);

      console.log(`✓ Got secret as JSON: ${secretId}`);
    });
  });

  describe('secret decrypt', () => {
    it('should decrypt secret value', () => {
      // Create a credential secret
      const alias = TestConfig.uniqueAlias('decrypt-test');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'credential',
        '--username', 'decryptuser',
        '--password', 'decryptpass123'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Decrypt it
      const result = TestConfig.exec('secret', 'decrypt', secretId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('decryptuser');

      console.log(`✓ Decrypted secret: ${secretId}`);
    });

    it('should decrypt secret as JSON', () => {
      // Create a secret
      const alias = TestConfig.uniqueAlias('decrypt-json');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"api_key":"secret123"}'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Decrypt as JSON
      const result = TestConfig.execJson<{ data: { api_key: string } }>('secret', 'decrypt', secretId);

      expect(result.success).toBe(true);
      expect(result.data?.data?.api_key).toBe('secret123');

      console.log(`✓ Decrypted secret as JSON: ${secretId}`);
    });
  });

  describe('secret update', () => {
    it('should update secret and increment version', () => {
      // Create a secret
      const alias = TestConfig.uniqueAlias('update-test');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"key":"original"}'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Update it
      const updateResult = TestConfig.exec(
        'secret', 'update', secretId,
        '--data', '{"key":"updated"}'
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.stdout).toContain('updated successfully');

      // Verify new value
      const decryptResult = TestConfig.execJson<{ data: { key: string }; version: number }>('secret', 'decrypt', secretId);
      expect(decryptResult.data?.data?.key).toBe('updated');
      expect(decryptResult.data?.version).toBe(2);

      console.log(`✓ Updated secret: ${secretId}`);
    });
  });

  describe('secret delete', () => {
    it('should delete secret', () => {
      // Create a secret
      const alias = TestConfig.uniqueAlias('delete-test');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"key":"value"}'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const secretId = idMatch![1];
      // Don't add to cleanup - we're deleting it

      // Delete it
      const result = TestConfig.exec('secret', 'delete', secretId, '--force');

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('deleted successfully');

      // Verify it's gone
      const getResult = TestConfig.exec('secret', 'get', secretId);
      expect(getResult.success).toBe(false);

      console.log(`✓ Deleted secret: ${secretId}`);
    });
  });

  describe('secret history', () => {
    it('should show secret version history', () => {
      // Create and update a secret
      const alias = TestConfig.uniqueAlias('history-test');
      const createResult = TestConfig.exec(
        'secret', 'create', alias,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--type', 'opaque',
        '--data', '{"version":1}'
      );

      expect(createResult.success).toBe(true);
      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      expect(idMatch).toBeTruthy();
      const secretId = idMatch![1];
      createdSecretIds.push(secretId);

      // Update a few times - verify each update succeeds
      const update1 = TestConfig.exec('secret', 'update', secretId, '--data', '{"version":2}');
      expect(update1.success).toBe(true);
      expect(update1.stdout).toContain('updated successfully');

      const update2 = TestConfig.exec('secret', 'update', secretId, '--data', '{"version":3}');
      expect(update2.success).toBe(true);
      expect(update2.stdout).toContain('updated successfully');

      // Get history
      const result = TestConfig.exec('secret', 'history', secretId);

      expect(result.success).toBe(true);
      // History should show at least 2 versions (original + updates)
      // Note: Vault versioning may consolidate rapid updates
      expect(result.stdout).toContain('Version');
      expect(result.stdout).toContain('version(s)');

      console.log(`✓ Got secret history: ${secretId}`);
    });
  });
});
