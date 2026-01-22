// Path: znvault-cli/test/integration/policy.integration.test.ts

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for ABAC policy CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: npm test (includes Docker setup)
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Policy Commands Integration', () => {
  const createdPolicyIds: string[] = [];

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin for policy operations
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');
  });

  afterEach(async () => {
    // Cleanup created policies
    for (const id of createdPolicyIds) {
      try {
        TestConfig.exec('policy', 'delete', id, '--yes');
        console.log(`  Cleaned up policy: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdPolicyIds.length = 0;
  });

  describe('policy list', () => {
    it('should list policies', () => {
      const result = TestConfig.exec('policy', 'list');

      expect(result.success).toBe(true);
      // Should show policies or empty list
      expect(result.stdout.toLowerCase()).toMatch(/polic|no|total|empty/i);
      console.log('✓ Listed policies');
    });

    it('should list policies as JSON', () => {
      const result = TestConfig.execJson('policy', 'list');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      console.log('✓ Listed policies as JSON');
    });

    it('should filter policies by tenant', () => {
      const result = TestConfig.exec('policy', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      console.log('✓ Listed policies filtered by tenant');
    });
  });

  describe('policy create', () => {
    it('should create a simple policy', () => {
      const policyName = TestConfig.uniqueId('test-policy');

      const result = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value,secret:list:values',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout.toLowerCase()).toContain(policyName.toLowerCase());

      // Extract policy ID for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdPolicyIds.push(idMatch[1]);
      }

      console.log(`✓ Created policy: ${policyName}`);
    });

    it('should create policy with description', () => {
      const policyName = TestConfig.uniqueId('described-policy');

      const result = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--description', 'Test policy with description',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdPolicyIds.push(idMatch[1]);
      }

      console.log(`✓ Created policy with description: ${policyName}`);
    });

    it('should create policy with priority', () => {
      const policyName = TestConfig.uniqueId('priority-policy');

      const result = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'deny',
        '--actions', 'secret:delete',
        '--resources', '["secret:*"]',
        '--priority', '100',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdPolicyIds.push(idMatch[1]);
      }

      console.log(`✓ Created policy with priority: ${policyName}`);
    });

    it('should create policy and return JSON', () => {
      const policyName = TestConfig.uniqueId('json-policy');

      const result = TestConfig.execJson<{ id: string; name: string }>(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data?.id).toBeDefined();

      if (result.data?.id) {
        createdPolicyIds.push(result.data.id);
      }

      console.log(`✓ Created policy as JSON: ${policyName}`);
    });
  });

  describe('policy get', () => {
    it('should get policy details', () => {
      // Create a policy first
      const policyName = TestConfig.uniqueId('get-test-policy');
      const createResult = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      expect(idMatch).toBeTruthy();
      const policyId = idMatch![1];
      createdPolicyIds.push(policyId);

      // Get the policy
      const result = TestConfig.exec('policy', 'get', policyId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(policyId);
      expect(result.stdout.toLowerCase()).toContain(policyName.toLowerCase());

      console.log(`✓ Got policy details: ${policyId}`);
    });

    it('should get policy as JSON', () => {
      // Create a policy
      const policyName = TestConfig.uniqueId('get-json-policy');
      const createResult = TestConfig.execJson<{ id: string }>(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      const policyId = createResult.data?.id;
      expect(policyId).toBeDefined();
      createdPolicyIds.push(policyId!);

      // Get as JSON
      const result = TestConfig.execJson<{ id: string; name: string }>('policy', 'get', policyId!);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(policyId);

      console.log(`✓ Got policy as JSON: ${policyId}`);
    });
  });

  describe('policy update', () => {
    it('should update policy description', () => {
      // Create a policy
      const policyName = TestConfig.uniqueId('update-test-policy');
      const createResult = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const policyId = idMatch![1];
      createdPolicyIds.push(policyId);

      // Update the policy
      const result = TestConfig.exec(
        'policy', 'update', policyId,
        '--description', 'Updated description'
      );

      expect(result.success).toBe(true);
      expect(result.stdout.toLowerCase()).toContain('updated');

      console.log(`✓ Updated policy: ${policyId}`);
    });
  });

  describe('policy enable/disable', () => {
    it('should disable a policy', () => {
      // Create a policy
      const policyName = TestConfig.uniqueId('disable-test-policy');
      const createResult = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const policyId = idMatch![1];
      createdPolicyIds.push(policyId);

      // Disable the policy
      const disableResult = TestConfig.exec('policy', 'disable', policyId);
      expect(disableResult.success).toBe(true);
      // The spinner output goes to stderr
      const combined = (disableResult.stdout + disableResult.stderr).toLowerCase();
      expect(combined).toContain('disabled');

      console.log(`✓ Disabled policy: ${policyId}`);
    });

    it('should enable a disabled policy', () => {
      // Create and disable a policy
      const policyName = TestConfig.uniqueId('enable-test-policy');
      const createResult = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const policyId = idMatch![1];
      createdPolicyIds.push(policyId);

      // Disable then enable
      TestConfig.exec('policy', 'disable', policyId);
      const enableResult = TestConfig.exec('policy', 'enable', policyId);

      expect(enableResult.success).toBe(true);
      // The spinner output goes to stderr
      const combined = (enableResult.stdout + enableResult.stderr).toLowerCase();
      expect(combined).toContain('enabled');

      console.log(`✓ Enabled policy: ${policyId}`);
    });
  });

  describe('policy delete', () => {
    it('should delete a policy', () => {
      // Create a policy
      const policyName = TestConfig.uniqueId('delete-test-policy');
      const createResult = TestConfig.exec(
        'policy', 'create',
        '--name', policyName,
        '--effect', 'allow',
        '--actions', 'secret:read:value',
        '--resources', '["secret:*"]',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const policyId = idMatch![1];
      // Don't add to cleanup - we're deleting it

      // Delete the policy
      const result = TestConfig.exec('policy', 'delete', policyId, '--yes');

      expect(result.success).toBe(true);
      // The spinner output goes to stderr
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toContain('deleted');

      // Verify it's gone
      const getResult = TestConfig.exec('policy', 'get', policyId);
      expect(getResult.success).toBe(false);

      console.log(`✓ Deleted policy: ${policyId}`);
    });
  });
});
