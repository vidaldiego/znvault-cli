// Path: znvault-cli/test/integration/agent.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for agent CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: npm test (includes Docker setup)
 *
 * Note: Agent registration is typically done via zn-vault-agent binary,
 * not the CLI. The CLI manages existing agents and registration tokens.
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Agent Commands Integration', () => {
  const createdTokenIds: string[] = [];
  let managedKeyName: string;

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin for agent operations
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');

    // Create a managed key for token tests
    managedKeyName = TestConfig.uniqueId('agent-test-key');
    const createKeyResult = TestConfig.exec(
      'apikey', 'managed', 'create', managedKeyName,
      '--permissions', 'secret:read:value',
      '--rotation-mode', 'on-use',
      '--tenant', TestConfig.DEFAULT_TENANT
    );
    if (!createKeyResult.success) {
      console.log('Note: Managed key creation failed, token tests may be skipped');
      console.log(createKeyResult.stderr || createKeyResult.stdout);
    } else {
      console.log(`✓ Created managed key: ${managedKeyName}`);
    }
  });

  afterAll(async () => {
    // Cleanup created tokens
    for (const id of createdTokenIds) {
      try {
        TestConfig.exec('agent', 'token', 'revoke', id, '--managed-key', managedKeyName, '--tenant', TestConfig.DEFAULT_TENANT, '--yes');
        console.log(`  Cleaned up token: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdTokenIds.length = 0;

    // Cleanup managed key
    if (managedKeyName) {
      try {
        TestConfig.exec('apikey', 'managed', 'delete', managedKeyName, '--tenant', TestConfig.DEFAULT_TENANT, '--force');
        console.log(`  Cleaned up managed key: ${managedKeyName}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('agent remote list', () => {
    it('should list remote agents', () => {
      const result = TestConfig.exec('agent', 'remote', 'list');

      expect(result.success).toBe(true);
      // Should show agents or empty list
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toMatch(/agent|no|total|connection/i);
      console.log('✓ Listed remote agents');
    });

    it('should list agents as JSON', () => {
      const result = TestConfig.execJson<{ agents: unknown[]; pagination: { totalItems: number } }>(
        'agent', 'remote', 'list'
      );

      expect(result.success).toBe(true);
      expect(result.data?.agents).toBeDefined();
      expect(Array.isArray(result.data?.agents)).toBe(true);
      console.log('✓ Listed agents as JSON');
    });

    it('should filter agents by tenant', () => {
      const result = TestConfig.exec('agent', 'remote', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      console.log('✓ Listed agents filtered by tenant');
    });

    it('should filter agents by status', () => {
      const result = TestConfig.exec('agent', 'remote', 'list', '--status', 'online');

      expect(result.success).toBe(true);
      console.log('✓ Listed agents filtered by status');
    });
  });

  describe('agent remote connections', () => {
    it('should list active connections', () => {
      const result = TestConfig.exec('agent', 'remote', 'connections');

      expect(result.success).toBe(true);
      // Should show connections or empty message
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toMatch(/connection|no|active|agent/i);
      console.log('✓ Listed agent connections');
    });

    it('should list connections as JSON', () => {
      const result = TestConfig.execJson<{ connections: unknown[]; totalConnections: number }>(
        'agent', 'remote', 'connections'
      );

      expect(result.success).toBe(true);
      expect(result.data?.connections).toBeDefined();
      console.log('✓ Listed connections as JSON');
    });
  });

  describe('agent token list', () => {
    it('should list registration tokens', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.exec('agent', 'token', 'list', '--managed-key', managedKeyName, '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      // Should show tokens or empty list
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toMatch(/token|no|total|registration/i);
      console.log('✓ Listed registration tokens');
    });

    it('should list tokens as JSON', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.execJson<{ tokens: unknown[] }>('agent', 'token', 'list', '--managed-key', managedKeyName, '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      console.log('✓ Listed tokens as JSON');
    });
  });

  describe('agent token create', () => {
    it('should create a registration token', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.exec(
        'agent', 'token', 'create',
        '--managed-key', managedKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('token');

      // Extract token ID for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_-]+)/i);
      if (idMatch) {
        createdTokenIds.push(idMatch[1]);
      }

      console.log('✓ Created registration token');
    });

    it('should create token with description', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.exec(
        'agent', 'token', 'create',
        '--managed-key', managedKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--description', 'Test token with description'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_-]+)/i);
      if (idMatch) {
        createdTokenIds.push(idMatch[1]);
      }

      console.log('✓ Created token with description');
    });

    it('should create token with expiry', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.exec(
        'agent', 'token', 'create',
        '--managed-key', managedKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--expires', '24h'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-zA-Z0-9_-]+)/i);
      if (idMatch) {
        createdTokenIds.push(idMatch[1]);
      }

      console.log('✓ Created token with expiry');
    });

    it('should create token and return JSON', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      const result = TestConfig.execJson<{ id: string; token: string }>(
        'agent', 'token', 'create',
        '--managed-key', managedKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data?.token).toBeDefined();

      if (result.data?.id) {
        createdTokenIds.push(result.data.id);
      }

      console.log('✓ Created token as JSON');
    });
  });

  describe('agent token revoke', () => {
    it('should revoke a registration token', () => {
      // Skip if no managed key available
      if (!managedKeyName) {
        console.log('Skipping: no managed key available');
        return;
      }

      // Create a token first
      const createResult = TestConfig.exec(
        'agent', 'token', 'create',
        '--managed-key', managedKeyName,
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-zA-Z0-9_-]+)/i);
      expect(idMatch).toBeTruthy();
      const tokenId = idMatch![1];
      // Don't add to cleanup - we're revoking it

      // Revoke the token
      const result = TestConfig.exec('agent', 'token', 'revoke', tokenId, '--managed-key', managedKeyName, '--tenant', TestConfig.DEFAULT_TENANT, '--yes');

      expect(result.success).toBe(true);
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('revoked');

      console.log(`✓ Revoked registration token: ${tokenId}`);
    });
  });
});
