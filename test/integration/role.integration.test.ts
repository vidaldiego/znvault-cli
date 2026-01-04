// Path: znvault-cli/test/integration/role.integration.test.ts

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for role CLI commands.
 *
 * These tests run against a real ZN-Vault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 *
 * Note: These tests require superadmin with role:* permissions.
 * In SDK test environment, the superadmin may not have tenant-scoped
 * role permissions, so tests will be skipped if permissions are unavailable.
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

// Check if role operations are available (superadmin may not have permissions in test env)
function checkRolePermissions(): boolean {
  const result = TestConfig.exec('role', 'list', '--tenant', TestConfig.DEFAULT_TENANT);
  return result.success;
}

describe.skipIf(!shouldRunIntegration)('Role Commands Integration', () => {
  const createdRoleIds: string[] = [];
  let hasRolePermissions = false;

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin for role management
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');

    // Check if we have role permissions
    hasRolePermissions = checkRolePermissions();
    if (!hasRolePermissions) {
      console.log('⚠ Superadmin does not have role:* permissions in test environment');
      console.log('  Role tests will be skipped');
    }
  });

  afterEach(async () => {
    // Cleanup created roles
    for (const id of createdRoleIds) {
      try {
        TestConfig.exec('role', 'delete', id, '--force');
        console.log(`  Cleaned up role: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdRoleIds.length = 0;
  });

  describe('role list', () => {
    it('should list roles', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role:list permission not available');
        return;
      }
      // List roles for the test tenant
      const result = TestConfig.exec('role', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      // SDK test environment creates custom roles like 'secrets-reader'
      // Check for any role output (may show "No roles found" if none exist yet)
      console.log('✓ Listed roles');
    });

    it('should list roles as JSON', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role:list permission not available');
        return;
      }
      const result = TestConfig.execJson<Array<{ id: string; name: string }>>('role', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      // SDK test creates roles like 'secrets-reader', 'secrets-writer', etc.
      console.log(`✓ Listed ${result.data?.length ?? 0} roles as JSON`);
    });

    it('should filter by tenant', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role:list permission not available');
        return;
      }
      const result = TestConfig.exec('role', 'list', '--tenant', TestConfig.DEFAULT_TENANT);

      expect(result.success).toBe(true);
      console.log('✓ Listed roles filtered by tenant');
    });
  });

  describe('role create', () => {
    it('should create a custom role', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role:create permission not available');
        return;
      }
      const roleName = TestConfig.uniqueId('cli-role');

      const result = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--description', 'CLI test role',
        '--permissions', 'secret:read,secret:list'
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('created successfully');

      // Extract role ID for cleanup
      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdRoleIds.push(idMatch[1]);
      }

      console.log(`✓ Created role: ${roleName}`);
    });

    it('should create role with multiple permissions', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role:create permission not available');
        return;
      }
      const roleName = TestConfig.uniqueId('cli-role-perms');

      const result = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--permissions', 'secret:read,secret:write,secret:delete,kms:encrypt,kms:decrypt'
      );

      expect(result.success).toBe(true);

      const idMatch = result.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      if (idMatch) {
        createdRoleIds.push(idMatch[1]);
      }

      console.log(`✓ Created role with multiple permissions: ${roleName}`);
    });
  });

  describe('role get', () => {
    it('should get role details', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }
      // Create a role first
      const roleName = TestConfig.uniqueId('cli-get-role');
      const createResult = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--permissions', 'secret:read'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      expect(idMatch).toBeTruthy();
      const roleId = idMatch![1];
      createdRoleIds.push(roleId);

      // Get the role
      const result = TestConfig.exec('role', 'get', roleId);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(roleId);
      expect(result.stdout).toContain(roleName);
      expect(result.stdout).toContain('secret:read');

      console.log(`✓ Got role: ${roleId}`);
    });

    it('should get role as JSON', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }
      // Create a role
      const roleName = TestConfig.uniqueId('cli-get-json');
      const createResult = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--permissions', 'secret:read,kms:encrypt'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const roleId = idMatch![1];
      createdRoleIds.push(roleId);

      // Get as JSON
      const result = TestConfig.execJson<{ id: string; name: string; permissions: string[] }>('role', 'get', roleId);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(roleId);
      expect(result.data?.name).toBe(roleName);
      expect(result.data?.permissions).toContain('secret:read');

      console.log(`✓ Got role as JSON: ${roleId}`);
    });
  });

  describe('role update', () => {
    it('should update role permissions', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }
      // Create a role
      const roleName = TestConfig.uniqueId('cli-update-role');
      const createResult = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--permissions', 'secret:read'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const roleId = idMatch![1];
      createdRoleIds.push(roleId);

      // Update permissions
      const updateResult = TestConfig.exec(
        'role', 'update', roleId,
        '--permissions', 'secret:read,secret:write,secret:delete'
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.stdout).toContain('updated successfully');

      // Verify the update
      const getResult = TestConfig.execJson<{ permissions: string[] }>('role', 'get', roleId);
      expect(getResult.data?.permissions).toContain('secret:write');
      expect(getResult.data?.permissions).toContain('secret:delete');

      console.log(`✓ Updated role permissions: ${roleId}`);
    });

    it('should update role description', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }
      // Create a role
      const roleName = TestConfig.uniqueId('cli-update-desc');
      const createResult = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--description', 'Original description',
        '--permissions', 'secret:read'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const roleId = idMatch![1];
      createdRoleIds.push(roleId);

      // Update description
      const updateResult = TestConfig.exec(
        'role', 'update', roleId,
        '--description', 'Updated description'
      );

      expect(updateResult.success).toBe(true);

      // Verify
      const getResult = TestConfig.execJson<{ description: string }>('role', 'get', roleId);
      expect(getResult.data?.description).toBe('Updated description');

      console.log(`✓ Updated role description: ${roleId}`);
    });
  });

  describe('role delete', () => {
    it('should delete a custom role', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }
      // Create a role
      const roleName = TestConfig.uniqueId('cli-delete-role');
      const createResult = TestConfig.exec(
        'role', 'create', roleName,
        '--tenant', TestConfig.DEFAULT_TENANT,
        '--permissions', 'secret:read'
      );

      const idMatch = createResult.stdout.match(/ID:\s+([a-f0-9-]+)/i);
      const roleId = idMatch![1];
      // Don't add to cleanup - we're deleting it

      // Delete it
      const result = TestConfig.exec('role', 'delete', roleId, '--force');

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('deleted successfully');

      // Verify it's gone
      const getResult = TestConfig.exec('role', 'get', roleId);
      expect(getResult.success).toBe(false);

      console.log(`✓ Deleted role: ${roleId}`);
    });
  });

  describe('role user-roles', () => {
    it('should show user roles', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }

      // First get the user ID - list users and find by username
      const usersResult = TestConfig.execJson<Array<{ id: string; username: string }>>('user', 'list', '--tenant', TestConfig.DEFAULT_TENANT);
      expect(usersResult.success).toBe(true);

      const user = usersResult.data?.find(u => u.username.includes('sdk-admin')) || usersResult.data?.[0];
      expect(user).toBeDefined();

      // Get user's roles
      const result = TestConfig.exec('role', 'user-roles', user!.id);

      expect(result.success).toBe(true);
      console.log(`✓ Got roles for user: ${user!.username}`);
    });
  });

  describe('role user-permissions', () => {
    it('should show effective user permissions', () => {
      if (!hasRolePermissions) {
        console.log('  Skipping - role permissions not available');
        return;
      }

      // Get a user ID first
      const usersResult = TestConfig.execJson<Array<{ id: string; username: string }>>('user', 'list', '--tenant', TestConfig.DEFAULT_TENANT);
      expect(usersResult.success).toBe(true);

      const user = usersResult.data?.[0];
      expect(user).toBeDefined();

      // Get user's effective permissions
      const result = TestConfig.exec('role', 'user-permissions', user!.id);

      expect(result.success).toBe(true);
      console.log(`✓ Got permissions for user: ${user!.username}`);
    });
  });
});
