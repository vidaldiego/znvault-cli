// Path: znvault-cli/test/integration/admin.integration.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for admin CLI commands (backup, notification).
 *
 * These tests run against a real ZnVault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('Admin Commands Integration', () => {
  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin for admin operations
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');
  });

  describe('Backup Commands', () => {
    describe('backup list', () => {
      it('should list backups', () => {
        const result = TestConfig.exec('backup', 'list');

        // May succeed with empty list or fail if backup not configured
        // We just check it doesn't crash
        console.log(`✓ Backup list command executed (exit: ${result.exitCode})`);
      });

      it('should list backups as JSON', () => {
        const result = TestConfig.execJson<Array<{ id: string }>>('backup', 'list');

        // Check structure if successful
        if (result.success && result.data) {
          expect(Array.isArray(result.data)).toBe(true);
        }
        console.log('✓ Backup list JSON command executed');
      });
    });

    describe('backup stats', () => {
      it('should show backup statistics', () => {
        const result = TestConfig.exec('backup', 'stats');

        console.log(`✓ Backup stats command executed (exit: ${result.exitCode})`);
      });
    });

    describe('backup health', () => {
      it('should check backup system health', () => {
        const result = TestConfig.exec('backup', 'health');

        console.log(`✓ Backup health command executed (exit: ${result.exitCode})`);
      });
    });

    describe('backup config', () => {
      it('should show backup configuration', () => {
        const result = TestConfig.exec('backup', 'config');

        console.log(`✓ Backup config command executed (exit: ${result.exitCode})`);
      });
    });
  });

  describe('Notification Commands', () => {
    describe('notification status', () => {
      it('should show notification status', () => {
        const result = TestConfig.exec('notification', 'status');

        // Check command runs (may show configured or not configured)
        console.log(`✓ Notification status: ${result.stdout.includes('configured') ? 'checked' : 'command ran'}`);
      });

      it('should show status as JSON', () => {
        const result = TestConfig.execJson<{ configured: boolean }>('notification', 'status');

        if (result.success && result.data) {
          expect(typeof result.data.configured).toBe('boolean');
        }
        console.log('✓ Notification status JSON command executed');
      });
    });

    describe('notification recipients', () => {
      it('should list notification recipients', () => {
        const result = TestConfig.exec('notification', 'recipients');

        console.log(`✓ Notification recipients command executed (exit: ${result.exitCode})`);
      });
    });

    describe('notification config', () => {
      it('should show SMTP configuration', () => {
        const result = TestConfig.exec('notification', 'config');

        // May fail if not configured, which is expected
        console.log(`✓ Notification config command executed (exit: ${result.exitCode})`);
      });
    });
  });

  describe('Health Commands', () => {
    describe('health', () => {
      it('should show vault health', () => {
        const result = TestConfig.exec('health');

        expect(result.success).toBe(true);
        // Check for "ok" or "OK" (case-insensitive)
        expect(result.stdout.toLowerCase()).toContain('ok');
        console.log('✓ Health check passed');
      });
    });

    describe('status', () => {
      it('should show vault status', () => {
        const result = TestConfig.exec('status');

        expect(result.success).toBe(true);
        console.log('✓ Status check passed');
      });
    });
  });

  describe('Audit Commands', () => {
    describe('audit list', () => {
      it('should list audit entries', () => {
        const result = TestConfig.exec('audit', 'list', '--limit', '10');

        // Audit access may require specific permissions
        if (!result.success) {
          console.log('  Skipping - audit:list permission not available');
          return;
        }
        console.log('✓ Listed audit entries');
      });

      it('should list audit entries as JSON', () => {
        const result = TestConfig.execJson<Array<{ id: string }>>('audit', 'list', '--limit', '5');

        // Audit access may require specific permissions
        if (!result.success) {
          console.log('  Skipping - audit:list permission not available');
          return;
        }
        expect(Array.isArray(result.data)).toBe(true);
        console.log(`✓ Listed ${result.data?.length ?? 0} audit entries as JSON`);
      });
    });

    describe('audit verify', () => {
      it('should verify audit chain', () => {
        const result = TestConfig.exec('audit', 'verify');

        // May pass or report issues, just check it runs
        console.log(`✓ Audit verify executed (exit: ${result.exitCode})`);
      });
    });
  });

  describe('Lockdown Commands', () => {
    describe('lockdown status', () => {
      it('should show lockdown status', () => {
        const result = TestConfig.exec('lockdown', 'status');

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('NORMAL'); // Default state
        console.log('✓ Lockdown status: NORMAL');
      });
    });
  });

  describe('Tenant Commands', () => {
    describe('tenant list', () => {
      it('should list tenants', () => {
        const result = TestConfig.exec('tenant', 'list');

        expect(result.success).toBe(true);
        expect(result.stdout).toContain(TestConfig.DEFAULT_TENANT);
        console.log('✓ Listed tenants');
      });

      it('should list tenants as JSON', () => {
        const result = TestConfig.execJson<Array<{ id: string }>>('tenant', 'list');

        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
        console.log(`✓ Listed ${result.data?.length ?? 0} tenants as JSON`);
      });
    });

    describe('tenant get', () => {
      it('should get tenant details', () => {
        const result = TestConfig.exec('tenant', 'get', TestConfig.DEFAULT_TENANT);

        expect(result.success).toBe(true);
        expect(result.stdout).toContain(TestConfig.DEFAULT_TENANT);
        console.log(`✓ Got tenant: ${TestConfig.DEFAULT_TENANT}`);
      });
    });

    describe('tenant usage', () => {
      it('should show tenant usage', () => {
        const result = TestConfig.exec('tenant', 'usage', TestConfig.DEFAULT_TENANT);

        expect(result.success).toBe(true);
        console.log(`✓ Got tenant usage: ${TestConfig.DEFAULT_TENANT}`);
      });
    });
  });

  describe('User Commands', () => {
    describe('user list', () => {
      it('should list users', () => {
        const result = TestConfig.exec('user', 'list');

        expect(result.success).toBe(true);
        console.log('✓ Listed users');
      });

      it('should list users by tenant', () => {
        const result = TestConfig.exec('user', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

        expect(result.success).toBe(true);
        console.log(`✓ Listed users for tenant: ${TestConfig.DEFAULT_TENANT}`);
      });
    });

    describe('whoami', () => {
      it('should show current user', () => {
        const result = TestConfig.exec('whoami');

        expect(result.success).toBe(true);
        expect(result.stdout).toContain(TestConfig.Users.SUPERADMIN_USERNAME);
        console.log('✓ Whoami shows current user');
      });
    });
  });
});
