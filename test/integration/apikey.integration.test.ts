// Path: znvault-cli/test/integration/apikey.integration.test.ts

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for API key CLI commands (non-managed keys).
 *
 * These tests run against a real ZnVault server.
 * Run with: npm test (includes Docker setup)
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('API Key Commands Integration', () => {
  const createdKeyIds: string[] = [];

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as tenant admin for API key operations
    const loginResult = TestConfig.loginAsTenantAdmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as tenant admin');
  });

  afterEach(async () => {
    // Cleanup created API keys
    for (const id of createdKeyIds) {
      try {
        TestConfig.exec('apikey', 'delete', id, '--force');
        console.log(`  Cleaned up API key: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdKeyIds.length = 0;
  });

  describe('apikey list', () => {
    it('should list API keys', () => {
      const result = TestConfig.exec('apikey', 'list');

      expect(result.success).toBe(true);
      // Should show keys or empty list indication
      expect(result.stdout.toLowerCase()).toMatch(/api|key|no|total/i);
      console.log('✓ Listed API keys');
    });

    it('should list API keys as JSON', () => {
      const result = TestConfig.execJson<{ keys: unknown[] }>('apikey', 'list');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      console.log('✓ Listed API keys as JSON');
    });
  });

  describe('apikey create', () => {
    it('should create an API key', () => {
      const keyName = TestConfig.uniqueId('test-key');

      const result = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value,secret:list:values',
        '--expires', '30'
      );

      expect(result.success).toBe(true);
      // The spinner output goes to stderr
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('created');

      // Extract key ID for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      if (idMatch) {
        createdKeyIds.push(idMatch[1]);
      }

      console.log(`✓ Created API key: ${keyName}`);
    });

    it('should create API key with description', () => {
      const keyName = TestConfig.uniqueId('described-key');

      const result = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value,secret:list:values',
        '--description', 'Test key with description',
        '--expires', '30'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      if (idMatch) {
        createdKeyIds.push(idMatch[1]);
      }

      console.log(`✓ Created API key with description: ${keyName}`);
    });

    it('should create API key and return JSON', () => {
      const keyName = TestConfig.uniqueId('json-key');

      const result = TestConfig.execJson<{ apiKey: { id: string; name: string }; key: string }>(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );

      expect(result.success).toBe(true);
      expect(result.data?.apiKey?.id).toBeDefined();
      expect(result.data?.key).toBeDefined();
      // Key should start with znv_ prefix
      expect(result.data?.key).toMatch(/^znv_/);

      if (result.data?.apiKey?.id) {
        createdKeyIds.push(result.data.apiKey.id);
      }

      console.log(`✓ Created API key as JSON: ${keyName}`);
    });

    it('should create API key with IP allowlist', () => {
      const keyName = TestConfig.uniqueId('ip-key');

      const result = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30',
        '--ip', '127.0.0.1,192.168.1.0/24'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      if (idMatch) {
        createdKeyIds.push(idMatch[1]);
      }

      console.log(`✓ Created API key with IP allowlist: ${keyName}`);
    });
  });

  describe('apikey show', () => {
    it('should show API key details', () => {
      // Create a key first
      const keyName = TestConfig.uniqueId('show-test-key');
      const createResult = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      expect(idMatch).toBeTruthy();
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Show the key
      const result = TestConfig.exec('apikey', 'show', keyId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(keyId);

      console.log(`✓ Showed API key details: ${keyId}`);
    });

    it('should show API key as JSON', () => {
      // Create a key
      const keyName = TestConfig.uniqueId('show-json-key');
      const createResult = TestConfig.execJson<{ apiKey: { id: string } }>(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);
      const keyId = createResult.data?.apiKey?.id;
      expect(keyId).toBeDefined();
      createdKeyIds.push(keyId!);

      // Show as JSON
      const result = TestConfig.execJson<{ id: string; name: string }>('apikey', 'show', keyId!);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(keyId);

      console.log(`✓ Showed API key as JSON: ${keyId}`);
    });
  });

  describe('apikey delete', () => {
    it('should delete an API key', () => {
      // Create a key
      const keyName = TestConfig.uniqueId('delete-test-key');
      const createResult = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      const keyId = idMatch![1];
      // Don't add to cleanup - we're deleting it

      // Delete the key
      const result = TestConfig.exec('apikey', 'delete', keyId, '--force');

      expect(result.success).toBe(true);
      // The spinner output goes to stderr
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toMatch(/deleted|revoked/i);

      console.log(`✓ Deleted API key: ${keyId}`);
    });
  });

  describe('apikey rotate', () => {
    it('should rotate an API key', () => {
      // Create a key
      const keyName = TestConfig.uniqueId('rotate-test-key');
      const createResult = TestConfig.execJson<{ apiKey: { id: string }; key: string }>(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);
      const keyId = createResult.data?.apiKey?.id;
      const originalKey = createResult.data?.key;
      expect(keyId).toBeDefined();
      createdKeyIds.push(keyId!);

      // Rotate the key
      const result = TestConfig.execJson<{ key: string }>('apikey', 'rotate', keyId!);

      expect(result.success).toBe(true);
      expect(result.data?.key).toBeDefined();
      // New key should be different
      expect(result.data?.key).not.toBe(originalKey);

      console.log(`✓ Rotated API key: ${keyId}`);
    });
  });

  describe('apikey enable/disable', () => {
    it('should disable an API key', () => {
      // Create a key
      const keyName = TestConfig.uniqueId('disable-test-key');
      const createResult = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Disable the key
      const result = TestConfig.exec('apikey', 'disable', keyId);

      expect(result.success).toBe(true);
      // The spinner output goes to stderr, success message to stdout
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('disabled');

      console.log(`✓ Disabled API key: ${keyId}`);
    });

    it('should enable a disabled API key', () => {
      // Create and disable a key
      const keyName = TestConfig.uniqueId('enable-test-key');
      const createResult = TestConfig.exec(
        'apikey', 'create', keyName,
        '--permissions', 'secret:read:value',
        '--expires', '30'
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-zA-Z0-9_]+)/i);
      const keyId = idMatch![1];
      createdKeyIds.push(keyId);

      // Disable then enable
      TestConfig.exec('apikey', 'disable', keyId);
      const result = TestConfig.exec('apikey', 'enable', keyId);

      expect(result.success).toBe(true);
      // The spinner output goes to stderr, success message to stdout
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('enabled');

      console.log(`✓ Enabled API key: ${keyId}`);
    });
  });
});
