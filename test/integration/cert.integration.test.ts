// Path: znvault-cli/test/integration/cert.integration.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for certificate CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: npm test (includes Docker setup)
 *
 * Note: Certificate storage tests require actual certificate files,
 * so we focus on list/stats/expiring operations which work without files.
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Certificate Commands Integration', () => {
  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as tenant admin for certificate operations
    const loginResult = TestConfig.loginAsTenantAdmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as tenant admin');
  });

  describe('cert list', () => {
    it('should list certificates', () => {
      const result = TestConfig.exec('cert', 'list');

      expect(result.success).toBe(true);
      // Output should show certificates or empty list
      expect(result.stdout.toLowerCase()).toMatch(/certificate|no cert|total|empty/i);
      console.log('✓ Listed certificates');
    });

    it('should list certificates as JSON', () => {
      const result = TestConfig.execJson('cert', 'list');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      console.log('✓ Listed certificates as JSON');
    });

    it('should filter certificates by status', () => {
      const result = TestConfig.exec('cert', 'list', '--status', 'ACTIVE');

      expect(result.success).toBe(true);
      console.log('✓ Listed certificates filtered by status');
    });

    it('should filter certificates by kind', () => {
      const result = TestConfig.exec('cert', 'list', '--kind', 'CUSTOM');

      expect(result.success).toBe(true);
      console.log('✓ Listed certificates filtered by kind');
    });
  });

  describe('cert stats', () => {
    it('should show certificate statistics', () => {
      const result = TestConfig.exec('cert', 'stats');

      expect(result.success).toBe(true);
      // Stats should include numbers or status information
      expect(result.stdout.toLowerCase()).toMatch(/total|active|expired|statistic|count|\d+/i);
      console.log('✓ Got certificate statistics');
    });

    it('should show statistics as JSON', () => {
      const result = TestConfig.execJson<{
        total?: number;
        active?: number;
        expired?: number;
      }>('cert', 'stats');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      console.log('✓ Got certificate statistics as JSON');
    });
  });

  describe('cert expiring', () => {
    it('should list expiring certificates', () => {
      const result = TestConfig.exec('cert', 'expiring', '--days', '30');

      expect(result.success).toBe(true);
      // Should show expiring certs or empty list
      expect(result.stdout).toBeDefined();
      console.log('✓ Listed expiring certificates');
    });

    it('should list expiring certificates as JSON', () => {
      const result = TestConfig.execJson('cert', 'expiring', '--days', '30');

      expect(result.success).toBe(true);
      console.log('✓ Listed expiring certificates as JSON');
    });

    it('should accept different day ranges', () => {
      const result = TestConfig.exec('cert', 'expiring', '--days', '90');

      expect(result.success).toBe(true);
      console.log('✓ Listed certificates expiring within 90 days');
    });
  });

  describe('cert get (with non-existent ID)', () => {
    it('should return error for non-existent certificate', () => {
      const result = TestConfig.exec('cert', 'get', 'non-existent-cert-id');

      // Should fail with appropriate error
      expect(result.success).toBe(false);
      expect(result.stderr.toLowerCase() + result.stdout.toLowerCase()).toMatch(/not found|error|invalid/i);
      console.log('✓ Correctly handled non-existent certificate');
    });
  });

  describe('cert decrypt (with non-existent ID)', () => {
    it('should return error for non-existent certificate', () => {
      const result = TestConfig.exec('cert', 'decrypt', 'non-existent-cert-id', '--purpose', 'test');

      // Should fail with appropriate error
      expect(result.success).toBe(false);
      expect(result.stderr.toLowerCase() + result.stdout.toLowerCase()).toMatch(/not found|error|invalid/i);
      console.log('✓ Correctly handled decrypt of non-existent certificate');
    });
  });

  describe('cert delete (with non-existent ID)', () => {
    it('should return error for non-existent certificate', () => {
      const result = TestConfig.exec('cert', 'delete', 'non-existent-cert-id', '--force');

      // Should fail with appropriate error
      expect(result.success).toBe(false);
      expect(result.stderr.toLowerCase() + result.stdout.toLowerCase()).toMatch(/not found|error|invalid/i);
      console.log('✓ Correctly handled delete of non-existent certificate');
    });
  });
});
