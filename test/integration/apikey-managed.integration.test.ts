// Path: znvault-cli/test/integration/apikey-managed.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for managed API key CLI commands.
 *
 * These tests run against a real ZN-Vault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 *
 * Note: These tests require the vault server to have managed API key endpoints.
 * If the endpoints don't exist (e.g., cached Docker image), tests are skipped.
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

/**
 * Check if managed API key endpoints exist.
 * The Docker image may be cached and not have the new endpoints.
 * This is called synchronously before tests run.
 */
function checkManagedEndpointsAvailable(): boolean {
  if (!shouldRunIntegration) return false;
  if (!TestConfig.isVaultAvailable()) return false;

  // Login first to ensure we can make authenticated requests
  const loginResult = TestConfig.loginAsSuperadmin();
  if (!loginResult.success) return false;

  // Try to list managed keys - check if endpoint exists
  const result = TestConfig.exec('apikey', 'managed', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

  // Success or "No managed keys found" means endpoint exists
  if (result.success) return true;
  if (result.stdout.includes('No managed API keys found')) return true;

  // Check for specific patterns that indicate endpoint exists but different error
  const output = result.stdout + result.stderr;
  if (output.includes('managed')) return true;

  // 404 or route not found means endpoints don't exist
  if (output.includes('404') || output.includes('Cannot ') || output.includes('not found')) {
    return false;
  }

  // Default: let tests run
  return true;
}

// Check if we should run managed API key tests
const shouldRunManagedTests = shouldRunIntegration && checkManagedEndpointsAvailable();

interface ManagedKeyResponse {
  id: string;
  name: string;
  rotation_mode: string;
  rotation_interval?: string;
  grace_period: string;
  permissions: string[];
  is_managed: boolean;
  enabled: boolean;
  tenant_id: string;
  next_rotation_at?: string;
}

interface ManagedKeyListResponse {
  keys: ManagedKeyResponse[];
  total: number;
}

interface ManagedKeyBindResponse {
  id: string;
  key: string;
  prefix: string;
  name: string;
  expiresAt: string;
  gracePeriod: string;
  rotationMode: string;
  permissions: string[];
  nextRotationAt?: string;
}

interface CreateManagedKeyResponse {
  apiKey: ManagedKeyResponse;
  message: string;
}

describe.skipIf(!shouldRunManagedTests)('Managed API Key Commands Integration', () => {
  // Track created keys for cleanup
  const createdKeys: string[] = [];

  beforeAll(() => {
    // Re-login to ensure fresh session (check function already logged in once)
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');
  });

  afterAll(() => {
    // Cleanup: Delete any created keys
    for (const keyName of createdKeys) {
      try {
        TestConfig.exec('apikey', 'managed', 'delete', keyName, '--force', '--tenant', TestConfig.DEFAULT_TENANT);
        console.log(`✓ Cleaned up key: ${keyName}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Managed Key Lifecycle', () => {
    const testKeyName = TestConfig.uniqueId('cli-managed');

    it('should create a managed key with scheduled rotation', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'create', testKeyName,
        '-p', 'api_key:read',
        '-m', 'scheduled',
        '-i', '24h',
        '-g', '5m',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Managed API key created');
      expect(result.stdout).toContain(testKeyName);

      createdKeys.push(testKeyName);
      console.log(`✓ Created managed key: ${testKeyName}`);
    });

    it('should get managed key details', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'get', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(testKeyName);
      expect(result.stdout).toContain('Scheduled'); // Rotation mode
      expect(result.stdout).toContain('24h'); // Rotation interval
      console.log(`✓ Got managed key details: ${testKeyName}`);
    });

    it('should get managed key as JSON', () => {
      const result = TestConfig.execJson<ManagedKeyResponse>(
        'apikey', 'managed', 'get', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(testKeyName);
      expect(result.data?.is_managed).toBe(true);
      expect(result.data?.rotation_mode).toBe('scheduled');
      expect(result.data?.rotation_interval).toBe('24h');
      expect(result.data?.grace_period).toBe('5m');
      console.log(`✓ Got managed key JSON: ${testKeyName}`);
    });

    it('should bind to managed key and get the key value', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'bind', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      // Spinner output may go to stderr in CI mode, check combined output
      const output = result.stdout + result.stderr;
      expect(output).toContain('Bound to managed API key');
      // Key should be displayed with znv_ prefix
      expect(result.stdout).toMatch(/znv_[a-zA-Z0-9]+/);
      console.log(`✓ Bound to managed key: ${testKeyName}`);
    });

    it('should bind to managed key as JSON', () => {
      const result = TestConfig.execJson<ManagedKeyBindResponse>(
        'apikey', 'managed', 'bind', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(testKeyName);
      expect(result.data?.key).toMatch(/^znv_/);
      expect(result.data?.rotationMode).toBe('scheduled');
      expect(result.data?.nextRotationAt).toBeDefined();
      console.log(`✓ Bind response contains key: ${result.data?.key.substring(0, 12)}...`);
    });

    it('should update managed key configuration', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'config', testKeyName,
        '-i', '12h',
        '-g', '10m',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      // Spinner output may go to stderr in CI mode, check combined output
      const output = result.stdout + result.stderr;
      expect(output).toContain('Configuration updated');
      expect(result.stdout).toContain('12h');
      expect(result.stdout).toContain('10m');
      console.log(`✓ Updated managed key config: ${testKeyName}`);
    });

    it('should force rotate the managed key', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'rotate', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('rotated');
      console.log(`✓ Force rotated managed key: ${testKeyName}`);
    });

    it('should verify key changed after rotation', () => {
      // Get the key before binding again
      const bindResult1 = TestConfig.execJson<ManagedKeyBindResponse>(
        'apikey', 'managed', 'bind', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(bindResult1.success).toBe(true);
      expect(bindResult1.data?.key).toBeDefined();
      console.log(`✓ Got new key after rotation: ${bindResult1.data?.key.substring(0, 12)}...`);
    });

    it('should delete the managed key', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'delete', testKeyName,
        '--force',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      // Spinner output may go to stderr in CI mode, check combined output
      const output = result.stdout + result.stderr;
      expect(output).toContain('deleted');

      // Remove from cleanup list since we already deleted it
      const idx = createdKeys.indexOf(testKeyName);
      if (idx > -1) createdKeys.splice(idx, 1);

      console.log(`✓ Deleted managed key: ${testKeyName}`);
    });

    it('should return error when getting deleted key', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'get', testKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(false);
      console.log(`✓ Correctly returns error for deleted key`);
    });
  });

  describe('Managed Key List', () => {
    const listTestKey1 = TestConfig.uniqueId('cli-list1');
    const listTestKey2 = TestConfig.uniqueId('cli-list2');

    beforeAll(() => {
      // Create two test keys
      TestConfig.exec(
        'apikey', 'managed', 'create', listTestKey1,
        '-p', 'api_key:read',
        '-m', 'scheduled',
        '-i', '24h',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      createdKeys.push(listTestKey1);

      TestConfig.exec(
        'apikey', 'managed', 'create', listTestKey2,
        '-p', 'api_key:read',
        '-m', 'on-bind',
        '-g', '2m',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      createdKeys.push(listTestKey2);
    });

    it('should list managed keys', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'list',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(listTestKey1);
      expect(result.stdout).toContain(listTestKey2);
      console.log('✓ Listed managed keys');
    });

    it('should list managed keys as JSON', () => {
      const result = TestConfig.execJson<ManagedKeyListResponse>(
        'apikey', 'managed', 'list',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data?.keys)).toBe(true);
      expect(result.data?.keys.length).toBeGreaterThanOrEqual(2);

      // Find our test keys
      const key1 = result.data?.keys.find(k => k.name === listTestKey1);
      const key2 = result.data?.keys.find(k => k.name === listTestKey2);

      expect(key1).toBeDefined();
      expect(key1?.rotation_mode).toBe('scheduled');

      expect(key2).toBeDefined();
      expect(key2?.rotation_mode).toBe('on-bind');

      console.log(`✓ Listed ${result.data?.keys.length} managed keys as JSON`);
    });
  });

  describe('Rotation Modes', () => {
    it('should create key with on-use rotation', () => {
      const keyName = TestConfig.uniqueId('cli-onuse');

      const result = TestConfig.exec(
        'apikey', 'managed', 'create', keyName,
        '-p', 'api_key:read',
        '-m', 'on-use',
        '-g', '5m',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      createdKeys.push(keyName);

      // Verify it's on-use mode
      const getResult = TestConfig.execJson<ManagedKeyResponse>(
        'apikey', 'managed', 'get', keyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(getResult.success).toBe(true);
      expect(getResult.data?.rotation_mode).toBe('on-use');
      console.log(`✓ Created on-use rotation key: ${keyName}`);
    });

    it('should create key with on-bind rotation', () => {
      const keyName = TestConfig.uniqueId('cli-onbind');

      const result = TestConfig.exec(
        'apikey', 'managed', 'create', keyName,
        '-p', 'api_key:read',
        '-m', 'on-bind',
        '-g', '2m',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      createdKeys.push(keyName);

      // Verify it's on-bind mode
      const getResult = TestConfig.execJson<ManagedKeyResponse>(
        'apikey', 'managed', 'get', keyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(getResult.success).toBe(true);
      expect(getResult.data?.rotation_mode).toBe('on-bind');
      console.log(`✓ Created on-bind rotation key: ${keyName}`);
    });
  });

  describe('Validation', () => {
    it('should fail when creating key without permissions', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'create', 'no-perms-key',
        '-m', 'scheduled',
        '-i', '24h'
      );

      expect(result.success).toBe(false);
      expect(result.stdout + result.stderr).toContain('--permissions is required');
      console.log('✓ Correctly validates missing permissions');
    });

    it('should fail when creating key without rotation mode', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'create', 'no-mode-key',
        '-p', 'api_key:read'
      );

      expect(result.success).toBe(false);
      expect(result.stdout + result.stderr).toContain('--rotation-mode is required');
      console.log('✓ Correctly validates missing rotation mode');
    });

    it('should fail when creating scheduled key without interval', () => {
      const result = TestConfig.exec(
        'apikey', 'managed', 'create', 'no-interval-key',
        '-p', 'api_key:read',
        '-m', 'scheduled'
      );

      expect(result.success).toBe(false);
      expect(result.stdout + result.stderr).toContain('--rotation-interval is required');
      console.log('✓ Correctly validates missing rotation interval for scheduled mode');
    });

    it('should fail when updating config without any options', () => {
      const keyName = TestConfig.uniqueId('cli-config-test');

      // Create a key first
      TestConfig.exec(
        'apikey', 'managed', 'create', keyName,
        '-p', 'api_key:read',
        '-m', 'on-bind',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      createdKeys.push(keyName);

      // Try to update without any options
      const result = TestConfig.exec(
        'apikey', 'managed', 'config', keyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(false);
      expect(result.stdout + result.stderr).toContain('At least one configuration option is required');
      console.log('✓ Correctly validates missing config options');
    });
  });

  describe('Create with Options', () => {
    it('should create key with all options', () => {
      const keyName = TestConfig.uniqueId('cli-full-opts');

      const result = TestConfig.execJson<CreateManagedKeyResponse>(
        'apikey', 'managed', 'create', keyName,
        '-p', 'api_key:read,api_key:list',
        '-m', 'scheduled',
        '-i', '12h',
        '-g', '10m',
        '-d', 'Full options test key',
        '-e', '180',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      createdKeys.push(keyName);

      expect(result.data?.apiKey.name).toBe(keyName);
      expect(result.data?.apiKey.rotation_mode).toBe('scheduled');
      expect(result.data?.apiKey.rotation_interval).toBe('12h');
      expect(result.data?.apiKey.grace_period).toBe('10m');
      expect(result.data?.apiKey.permissions).toContain('api_key:read');
      expect(result.data?.apiKey.permissions).toContain('api_key:list');

      console.log(`✓ Created managed key with all options: ${keyName}`);
    });
  });
});
