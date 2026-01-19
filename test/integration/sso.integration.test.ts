// Path: znvault-cli/test/integration/sso.integration.test.ts

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { TestConfig } from './test-config.js';

/**
 * Integration tests for SSO CLI commands.
 *
 * These tests run against a real ZnVault server.
 * Run with: ZNVAULT_INTEGRATION=true npm run test:integration
 */

const shouldRunIntegration = TestConfig.isIntegrationEnabled();

describe.skipIf(!shouldRunIntegration)('SSO Commands Integration', () => {
  const createdAppIds: string[] = [];

  beforeAll(() => {
    // Check vault is available
    if (!TestConfig.isVaultAvailable()) {
      throw new Error(`Vault not available at ${TestConfig.BASE_URL}`);
    }

    // Login as superadmin for SSO operations
    const loginResult = TestConfig.loginAsSuperadmin();
    if (!loginResult.success) {
      throw new Error(`Failed to login: ${loginResult.stderr}`);
    }
    console.log('✓ Logged in as superadmin');
  });

  afterEach(async () => {
    // Cleanup created apps
    for (const id of createdAppIds) {
      try {
        TestConfig.exec('sso', 'delete', id, '--yes');
        console.log(`  Cleaned up SSO app: ${id}`);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdAppIds.length = 0;
  });

  describe('sso list', () => {
    it('should list SSO apps', () => {
      const result = TestConfig.exec('sso', 'list');

      expect(result.success).toBe(true);
      // Output should contain table headers or "No SSO apps found"
      expect(
        result.stdout.includes('Name') ||
        result.stdout.includes('No SSO apps found')
      ).toBe(true);
      console.log('✓ Listed SSO apps');
    });

    it('should list SSO apps as JSON', () => {
      const result = TestConfig.execJson<Array<{ id: string }>>('sso', 'list');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      console.log(`✓ Listed ${result.data?.length ?? 0} SSO apps as JSON`);
    });
  });

  describe('sso create', () => {
    it('should create an SSO app with basic config', () => {
      const slug = TestConfig.uniqueId('sso-app');
      const name = `Test SSO App ${slug}`;

      const result = TestConfig.exec(
        'sso', 'create', name, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Client ID');
      expect(result.stdout).toContain('Client Secret');

      // Extract client ID for cleanup (it's the app identifier)
      const clientIdMatch = result.stdout.match(/Client ID:\s+(\S+)/);
      if (clientIdMatch) {
        createdAppIds.push(slug);
      }

      console.log(`✓ Created SSO app: ${slug}`);
    });

    it('should create an SSO app with full configuration', () => {
      const slug = TestConfig.uniqueId('sso-full');
      const name = `Full Config App ${slug}`;

      const result = TestConfig.exec(
        'sso', 'create', name, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--redirect-uri', 'http://localhost:3000/silent-callback',
        '--origin', 'http://localhost:3000',
        '--scope', 'openid',
        '--scope', 'profile',
        '--scope', 'email',
        '--grant-type', 'authorization_code',
        '--grant-type', 'refresh_token',
        '--pkce',
        '--token-ttl', '7200',
        '--refresh-ttl', '86400',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Client ID');
      expect(result.stdout).toContain('Client Secret');

      createdAppIds.push(slug);
      console.log(`✓ Created SSO app with full config: ${slug}`);
    });

    it('should create SSO app and return JSON', () => {
      const slug = TestConfig.uniqueId('sso-json');
      const name = `JSON App ${slug}`;

      const result = TestConfig.execJson<{
        id: string;
        client_id: string;
        client_secret: string;
        name: string;
        slug: string;
      }>(
        'sso', 'create', name, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );

      expect(result.success).toBe(true);
      expect(result.data?.client_id).toBeDefined();
      expect(result.data?.client_secret).toBeDefined();
      expect(result.data?.name).toBe(name);
      expect(result.data?.slug).toBe(slug);

      createdAppIds.push(slug);
      console.log(`✓ Created SSO app as JSON: ${slug}`);
    });
  });

  describe('sso get', () => {
    it('should get SSO app details by slug', () => {
      // Create an app first
      const slug = TestConfig.uniqueId('sso-get');
      const createResult = TestConfig.exec(
        'sso', 'create', `Get Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Get the app
      const result = TestConfig.exec('sso', 'get', slug);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(slug);
      expect(result.stdout).toContain('Client ID');
      expect(result.stdout).toContain('OAuth Configuration');

      console.log(`✓ Got SSO app details: ${slug}`);
    });

    it('should get SSO app as JSON', () => {
      // Create an app first
      const slug = TestConfig.uniqueId('sso-get-json');
      const createResult = TestConfig.exec(
        'sso', 'create', `Get JSON Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Get as JSON
      const result = TestConfig.execJson<{
        id: string;
        slug: string;
        client_id: string;
        redirect_uris: string[];
      }>('sso', 'get', slug);

      expect(result.success).toBe(true);
      expect(result.data?.slug).toBe(slug);
      expect(result.data?.client_id).toBeDefined();
      expect(result.data?.redirect_uris).toContain('http://localhost:3000/callback');

      console.log(`✓ Got SSO app as JSON: ${slug}`);
    });
  });

  describe('sso update', () => {
    it('should update SSO app name', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-update');
      const createResult = TestConfig.exec(
        'sso', 'create', `Update Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Update name
      const newName = `Updated Name ${slug}`;
      const updateResult = TestConfig.exec(
        'sso', 'update', slug,
        '--name', newName
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.stdout).toContain('updated successfully');

      console.log(`✓ Updated SSO app name: ${slug}`);
    });

    it('should add redirect URI to SSO app', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-add-uri');
      const createResult = TestConfig.exec(
        'sso', 'create', `Add URI Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Add another redirect URI
      const updateResult = TestConfig.exec(
        'sso', 'update', slug,
        '--add-redirect-uri', 'http://localhost:4000/callback'
      );

      expect(updateResult.success).toBe(true);

      // Verify both URIs exist
      const getResult = TestConfig.execJson<{ redirect_uris: string[] }>('sso', 'get', slug);
      expect(getResult.data?.redirect_uris).toContain('http://localhost:3000/callback');
      expect(getResult.data?.redirect_uris).toContain('http://localhost:4000/callback');

      console.log(`✓ Added redirect URI to SSO app: ${slug}`);
    });

    it('should update SSO app status to inactive', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-status');
      const createResult = TestConfig.exec(
        'sso', 'create', `Status Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Set to inactive
      const updateResult = TestConfig.exec(
        'sso', 'update', slug,
        '--status', 'inactive'
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.stdout).toContain('Inactive');

      console.log(`✓ Updated SSO app status: ${slug}`);
    });
  });

  describe('sso rotate-secret', () => {
    it('should rotate client secret', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-rotate');
      const createResult = TestConfig.exec(
        'sso', 'create', `Rotate Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Extract original secret
      const originalSecretMatch = createResult.stdout.match(/Client Secret:\s+(\S+)/);
      const originalSecret = originalSecretMatch?.[1];

      // Rotate secret
      const rotateResult = TestConfig.exec('sso', 'rotate-secret', slug);

      expect(rotateResult.success).toBe(true);
      expect(rotateResult.stdout).toContain('rotated successfully');
      expect(rotateResult.stdout).toContain('New Client Secret');

      // Verify new secret is different
      const newSecretMatch = rotateResult.stdout.match(/New Client Secret:\s+(\S+)/);
      const newSecret = newSecretMatch?.[1];
      expect(newSecret).not.toBe(originalSecret);

      console.log(`✓ Rotated client secret: ${slug}`);
    });

    it('should rotate client secret and return JSON', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-rotate-json');
      const createResult = TestConfig.exec(
        'sso', 'create', `Rotate JSON Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // Rotate secret as JSON
      const rotateResult = TestConfig.execJson<{
        client_secret: string;
        rotated_at: string;
      }>('sso', 'rotate-secret', slug);

      expect(rotateResult.success).toBe(true);
      expect(rotateResult.data?.client_secret).toBeDefined();
      expect(rotateResult.data?.rotated_at).toBeDefined();

      console.log(`✓ Rotated client secret as JSON: ${slug}`);
    });
  });

  describe('sso delete', () => {
    it('should delete SSO app', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-delete');
      const createResult = TestConfig.exec(
        'sso', 'create', `Delete Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      // Don't add to cleanup - we're deleting it

      // Delete app
      const deleteResult = TestConfig.exec('sso', 'delete', slug, '--yes');

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.stdout).toContain('deleted successfully');

      // Verify it's gone
      const getResult = TestConfig.exec('sso', 'get', slug);
      expect(getResult.success).toBe(false);

      console.log(`✓ Deleted SSO app: ${slug}`);
    });
  });

  describe('sso users', () => {
    it('should list users with access to app', () => {
      // Create an app
      const slug = TestConfig.uniqueId('sso-users-list');
      const createResult = TestConfig.exec(
        'sso', 'create', `Users List Test ${slug}`, slug,
        '--redirect-uri', 'http://localhost:3000/callback',
        '--tenant', TestConfig.DEFAULT_TENANT
      );
      expect(createResult.success).toBe(true);
      createdAppIds.push(slug);

      // List users (should be empty initially)
      const listResult = TestConfig.exec('sso', 'users', 'list', slug);

      expect(listResult.success).toBe(true);
      // Either shows empty message or table
      expect(
        listResult.stdout.includes('No users') ||
        listResult.stdout.includes('Username') ||
        listResult.stdout.includes('Total: 0')
      ).toBe(true);

      console.log(`✓ Listed SSO app users: ${slug}`);
    });

    // Note: Grant/revoke tests require a valid user ID from the tenant
    // These would need additional setup to create a test user first
  });
});
