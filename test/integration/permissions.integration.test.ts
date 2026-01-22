// Path: znvault-cli/test/integration/permissions.integration.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for permissions CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: npm test (includes Docker setup)
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Permissions Commands Integration', () => {
  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');
  });

  describe('permissions list', () => {
    it('should list all permissions', () => {
      const result = TestConfig.exec('permissions', 'list');

      expect(result.success).toBe(true);
      // Should show permissions
      expect(result.stdout.toLowerCase()).toMatch(/permission|secret|user|kms/i);
      console.log('✓ Listed all permissions');
    });

    it('should list permissions as JSON', () => {
      const result = TestConfig.execJson<{
        permissions: Array<{ permission: string; description: string; category: string }>;
        categories: string[];
        total: number;
      }>('permissions', 'list');

      expect(result.success).toBe(true);
      expect(result.data?.permissions).toBeDefined();
      expect(Array.isArray(result.data?.permissions)).toBe(true);
      expect(result.data?.total).toBeGreaterThan(0);

      console.log(`✓ Listed ${result.data?.total} permissions as JSON`);
    });

    it('should filter permissions by category', () => {
      const result = TestConfig.exec('permissions', 'list', '--category', 'secret');

      expect(result.success).toBe(true);
      // Should show secret-related permissions
      expect(result.stdout.toLowerCase()).toContain('secret');
      console.log('✓ Listed permissions filtered by category');
    });
  });

  describe('permissions categories', () => {
    it('should list permission categories', () => {
      const result = TestConfig.exec('permissions', 'categories');

      expect(result.success).toBe(true);
      // Should show category names
      expect(result.stdout.toLowerCase()).toMatch(/secret|user|kms|categor/i);
      console.log('✓ Listed permission categories');
    });

    it('should list categories as JSON', () => {
      const result = TestConfig.execJson<{ categories: string[] }>('permissions', 'categories');

      expect(result.success).toBe(true);
      expect(result.data?.categories).toBeDefined();
      expect(Array.isArray(result.data?.categories)).toBe(true);
      expect(result.data?.categories.length).toBeGreaterThan(0);

      console.log(`✓ Listed ${result.data?.categories.length} categories as JSON`);
    });
  });

  describe('permissions validate', () => {
    it('should validate valid permissions', () => {
      // Use full permission format that vault recognizes
      const result = TestConfig.exec('permissions', 'validate', 'secret:read:value', 'secret:list:values');

      expect(result.success).toBe(true);
      expect(result.stdout.toLowerCase()).toMatch(/valid|all/i);
      console.log('✓ Validated valid permissions');
    });

    it('should validate permissions as JSON', () => {
      const result = TestConfig.execJson<{
        valid: string[];
        invalid: string[];
        allValid: boolean;
      }>('permissions', 'validate', 'secret:read:value', 'user:list');

      expect(result.success).toBe(true);
      expect(result.data?.allValid).toBe(true);
      expect(result.data?.valid.length).toBeGreaterThan(0);

      console.log('✓ Validated permissions as JSON');
    });

    it('should detect invalid permissions', () => {
      // Test with clearly invalid permission
      const result = TestConfig.exec('permissions', 'validate', 'secret:read:value', 'completely:invalid:xyz:abc');

      // Command exits with code 1 when permissions are invalid
      // So we check that either it fails or shows invalid in output
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).toMatch(/invalid|error|fail/i);

      console.log('✓ Detected invalid permission');
    });
  });

  describe('permissions search', () => {
    it('should search permissions by keyword', () => {
      const result = TestConfig.exec('permissions', 'search', 'secret');

      expect(result.success).toBe(true);
      // Should find secret-related permissions
      expect(result.stdout.toLowerCase()).toContain('secret');
      console.log('✓ Searched permissions by keyword');
    });

    it('should search permissions as JSON', () => {
      const result = TestConfig.execJson<{
        permissions: Array<{ permission: string }>;
        total: number;
      }>('permissions', 'search', 'kms');

      expect(result.success).toBe(true);
      expect(result.data?.permissions).toBeDefined();
      // Should find KMS-related permissions
      const hasKms = result.data?.permissions.some(p =>
        p.permission.toLowerCase().includes('kms')
      );
      expect(hasKms).toBe(true);

      console.log(`✓ Found ${result.data?.total} permissions matching 'kms'`);
    });

    it('should handle no matches', () => {
      const result = TestConfig.exec('permissions', 'search', 'xyznonexistent');

      expect(result.success).toBe(true);
      // Should indicate no results
      expect(result.stdout.toLowerCase()).toMatch(/no|0|empty|found/i);
      console.log('✓ Handled no search matches');
    });
  });
});
