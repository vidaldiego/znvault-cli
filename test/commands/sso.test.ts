// Path: znvault-cli/test/commands/sso.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSSOCommands } from '../../src/commands/sso.js';

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock prompts
vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn(),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  keyValue: vi.fn(),
  formatDate: vi.fn((date: string) => date),
}));

import { client } from '../../src/lib/client.js';
import { promptConfirm } from '../../src/lib/prompts.js';
import * as output from '../../src/lib/output.js';

describe('SSO Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerSSOCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  // ============ List SSO Apps ============
  describe('sso list', () => {
    it('should list SSO apps', async () => {
      vi.mocked(client.get).mockResolvedValue({
        apps: [
          {
            id: 'app-123',
            name: 'Test App',
            slug: 'test-app',
            client_id: 'client_abc123def456ghi789',
            active: true,
            user_count: 5,
            allowed_grant_types: ['authorization_code', 'refresh_token'],
          },
        ],
        pagination: { total: 1 },
      });

      await program.parseAsync(['node', 'test', 'sso', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps');
      expect(output.table).toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Total: 1 app(s)');
    });

    it('should filter by tenant', async () => {
      vi.mocked(client.get).mockResolvedValue({ apps: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'sso', 'list', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps?tenantId=acme');
    });

    it('should filter by status', async () => {
      vi.mocked(client.get).mockResolvedValue({ apps: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'sso', 'list', '--status', 'active']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps?status=active');
    });

    it('should output JSON when --json flag is set', async () => {
      const apps = [{ id: 'app-1', name: 'Test' }];
      vi.mocked(client.get).mockResolvedValue({ apps, pagination: { total: 1 } });

      await program.parseAsync(['node', 'test', 'sso', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(apps);
    });

    it('should handle empty results', async () => {
      vi.mocked(client.get).mockResolvedValue({ apps: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'sso', 'list']);

      expect(output.info).toHaveBeenCalledWith('No SSO apps found');
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('API Error'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'list'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('API Error');
    });
  });

  // ============ Get SSO App ============
  describe('sso get', () => {
    it('should get SSO app details', async () => {
      const app = {
        id: 'app-123',
        name: 'Test App',
        slug: 'test-app',
        description: 'Test description',
        client_id: 'client_abc123',
        active: true,
        redirect_uris: ['https://example.com/callback'],
        allowed_origins: ['https://example.com'],
        allowed_grant_types: ['authorization_code'],
        allowed_scopes: ['openid', 'profile'],
        require_pkce: true,
        access_token_ttl_seconds: 3600,
        refresh_token_ttl_seconds: 604800,
        roles: ['admin', 'user'],
        default_role: 'user',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        user_count: 10,
        active_token_count: 5,
      };
      vi.mocked(client.get).mockResolvedValue(app);

      await program.parseAsync(['node', 'test', 'sso', 'get', 'app-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123');
      expect(output.section).toHaveBeenCalledWith('SSO App Details');
      expect(output.section).toHaveBeenCalledWith('OAuth Configuration');
      expect(output.section).toHaveBeenCalledWith('Roles');
    });

    it('should get app with tenant option', async () => {
      vi.mocked(client.get).mockResolvedValue({
        id: 'app-123',
        name: 'Test',
        slug: 'test',
        active: true,
        redirect_uris: [],
        allowed_origins: [],
        allowed_grant_types: [],
        allowed_scopes: [],
        require_pkce: true,
        access_token_ttl_seconds: 3600,
        refresh_token_ttl_seconds: 604800,
        roles: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      await program.parseAsync(['node', 'test', 'sso', 'get', 'app-123', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123?tenantId=acme');
    });

    it('should output JSON when --json flag is set', async () => {
      const app = { id: 'app-123', name: 'Test' };
      vi.mocked(client.get).mockResolvedValue(app);

      await program.parseAsync(['node', 'test', 'sso', 'get', 'app-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(app);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('App not found'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'get', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('App not found');
    });
  });

  // ============ Create SSO App ============
  describe('sso create', () => {
    it('should create an SSO app with required options', async () => {
      const response = {
        app: {
          id: 'new-app',
          name: 'New App',
          slug: 'new-app',
          client_id: 'client_new123',
          redirect_uris: ['https://example.com/callback'],
          allowed_scopes: ['openid', 'profile', 'email'],
          require_pkce: true,
        },
        client_secret: 'secret_abc123xyz',
      };
      vi.mocked(client.post).mockResolvedValue(response);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync([
        'node', 'test', 'sso', 'create', 'New App', 'new-app',
        '--redirect-uri', 'https://example.com/callback',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps', expect.objectContaining({
        name: 'New App',
        slug: 'new-app',
        redirect_uris: ['https://example.com/callback'],
        require_pkce: true,
      }));
      expect(output.warn).toHaveBeenCalledWith('Save the client secret now - it will not be shown again!');
      consoleSpy.mockRestore();
    });

    it('should create an SSO app with all options', async () => {
      const response = {
        app: {
          id: 'full-app',
          name: 'Full App',
          slug: 'full-app',
          client_id: 'client_full',
          redirect_uris: ['https://example.com/callback', 'https://example.com/auth'],
          allowed_scopes: ['openid', 'custom'],
          require_pkce: false,
        },
        client_secret: 'secret_full',
      };
      vi.mocked(client.post).mockResolvedValue(response);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync([
        'node', 'test', 'sso', 'create', 'Full App', 'full-app',
        '--tenant', 'acme',
        '--description', 'Full description',
        '--redirect-uri', 'https://example.com/callback',
        '--redirect-uri', 'https://example.com/auth',
        '--origin', 'https://example.com',
        '--scope', 'openid',
        '--scope', 'custom',
        '--grant-type', 'authorization_code',
        '--token-ttl', '7200',
        '--refresh-ttl', '1209600',
        '--no-pkce',
        '--role', 'admin',
        '--role', 'viewer',
        '--default-role', 'viewer',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps?tenantId=acme', expect.objectContaining({
        name: 'Full App',
        slug: 'full-app',
        description: 'Full description',
        redirect_uris: ['https://example.com/callback', 'https://example.com/auth'],
        allowed_origins: ['https://example.com'],
        allowed_scopes: ['openid', 'custom'],
        allowed_grant_types: ['authorization_code'],
        access_token_ttl_seconds: 7200,
        refresh_token_ttl_seconds: 1209600,
        require_pkce: false,
        roles: ['admin', 'viewer'],
        default_role: 'viewer',
      }));
      consoleSpy.mockRestore();
    });

    it('should output JSON when --json flag is set', async () => {
      const response = {
        app: { id: 'app-1', name: 'Test', client_id: 'client_1' },
        client_secret: 'secret_1',
      };
      vi.mocked(client.post).mockResolvedValue(response);

      await program.parseAsync([
        'node', 'test', 'sso', 'create', 'Test', 'test',
        '--redirect-uri', 'https://example.com/callback',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith({ ...response.app, client_secret: 'secret_1' });
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Slug already exists'));

      await expect(program.parseAsync([
        'node', 'test', 'sso', 'create', 'Test', 'existing-slug',
        '--redirect-uri', 'https://example.com/callback',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Slug already exists');
    });
  });

  // ============ Update SSO App ============
  describe('sso update', () => {
    it('should update app name', async () => {
      const current = {
        id: 'app-123',
        name: 'Old Name',
        redirect_uris: ['https://example.com/callback'],
        allowed_origins: [],
        allowed_scopes: ['openid'],
        updated_at: '2024-01-02T00:00:00Z',
        active: true,
      };
      const updated = { ...current, name: 'New Name' };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--name', 'New Name']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123', { name: 'New Name' });
      expect(output.success).toHaveBeenCalledWith('SSO app "New Name" updated successfully');
    });

    it('should add redirect URIs', async () => {
      const current = {
        id: 'app-123',
        name: 'Test',
        redirect_uris: ['https://example.com/callback'],
        allowed_origins: [],
        allowed_scopes: [],
        updated_at: '2024-01-02T00:00:00Z',
        active: true,
      };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue({ ...current, redirect_uris: ['https://example.com/callback', 'https://new.com/auth'] });

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--add-redirect-uri', 'https://new.com/auth']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123', {
        redirect_uris: ['https://example.com/callback', 'https://new.com/auth'],
      });
    });

    it('should remove redirect URIs', async () => {
      const current = {
        id: 'app-123',
        name: 'Test',
        redirect_uris: ['https://example.com/callback', 'https://old.com/auth'],
        allowed_origins: [],
        allowed_scopes: [],
        updated_at: '2024-01-02T00:00:00Z',
        active: true,
      };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue({ ...current, redirect_uris: ['https://example.com/callback'] });

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--remove-redirect-uri', 'https://old.com/auth']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123', {
        redirect_uris: ['https://example.com/callback'],
      });
    });

    it('should update status', async () => {
      const current = {
        id: 'app-123',
        name: 'Test',
        redirect_uris: [],
        allowed_origins: [],
        allowed_scopes: [],
        active: true,
        updated_at: '2024-01-02T00:00:00Z',
      };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue({ ...current, active: false });

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--status', 'inactive']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123', { active: false });
    });

    it('should update PKCE requirement', async () => {
      const current = {
        id: 'app-123',
        name: 'Test',
        redirect_uris: [],
        allowed_origins: [],
        allowed_scopes: [],
        require_pkce: true,
        updated_at: '2024-01-02T00:00:00Z',
        active: true,
      };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue({ ...current, require_pkce: false });

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--no-pkce']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123', { require_pkce: false });
    });

    it('should fail when no updates specified', async () => {
      const current = {
        id: 'app-123',
        name: 'Test',
        redirect_uris: [],
        allowed_origins: [],
        allowed_scopes: [],
        updated_at: '2024-01-02T00:00:00Z',
        active: true,
      };
      vi.mocked(client.get).mockResolvedValue(current);

      await expect(program.parseAsync(['node', 'test', 'sso', 'update', 'app-123'])).rejects.toThrow('process.exit(1)');
    });

    it('should output JSON when --json flag is set', async () => {
      const current = { id: 'app-123', name: 'Test', redirect_uris: [], allowed_origins: [], allowed_scopes: [], active: true, updated_at: '' };
      const updated = { ...current, name: 'Updated' };
      vi.mocked(client.get).mockResolvedValue(current);
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync(['node', 'test', 'sso', 'update', 'app-123', '--name', 'Updated', '--json']);

      expect(output.json).toHaveBeenCalledWith(updated);
    });
  });

  // ============ Delete SSO App ============
  describe('sso delete', () => {
    it('should delete app with confirmation', async () => {
      vi.mocked(client.get).mockResolvedValue({ id: 'app-123', name: 'Test App' });
      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'delete', 'app-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123');
      expect(promptConfirm).toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123');
      expect(output.success).toHaveBeenCalledWith('SSO app "Test App" deleted successfully');
    });

    it('should delete app with --yes flag', async () => {
      vi.mocked(client.get).mockResolvedValue({ id: 'app-123', name: 'Test App' });
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'delete', 'app-123', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123');
    });

    it('should delete with tenant option', async () => {
      vi.mocked(client.get).mockResolvedValue({ id: 'app-123', name: 'Test App' });
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'delete', 'app-123', '--tenant', 'acme', '--yes']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123?tenantId=acme');
      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123?tenantId=acme');
    });

    it('should cancel delete when not confirmed', async () => {
      vi.mocked(client.get).mockResolvedValue({ id: 'app-123', name: 'Test App' });
      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'sso', 'delete', 'app-123']);

      expect(client.delete).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Delete cancelled');
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('App not found'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'delete', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('App not found');
    });
  });

  // ============ Rotate Secret ============
  describe('sso rotate-secret', () => {
    it('should rotate client secret', async () => {
      vi.mocked(client.post).mockResolvedValue({
        client_secret: 'new_secret_xyz',
        rotated_at: '2024-01-02T00:00:00Z',
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'sso', 'rotate-secret', 'app-123']);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps/app-123/rotate-secret', {});
      expect(output.success).toHaveBeenCalledWith('Client secret rotated successfully');
      expect(output.warn).toHaveBeenCalledWith('Save the new client secret now - it will not be shown again!');
      consoleSpy.mockRestore();
    });

    it('should rotate with tenant option', async () => {
      vi.mocked(client.post).mockResolvedValue({
        client_secret: 'new_secret',
        rotated_at: '2024-01-02T00:00:00Z',
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'sso', 'rotate-secret', 'app-123', '--tenant', 'acme']);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps/app-123/rotate-secret?tenantId=acme', {});
      consoleSpy.mockRestore();
    });

    it('should output JSON when --json flag is set', async () => {
      const response = { client_secret: 'new_secret', rotated_at: '2024-01-02T00:00:00Z' };
      vi.mocked(client.post).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'sso', 'rotate-secret', 'app-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(response);
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Rotation failed'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'rotate-secret', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Rotation failed');
    });
  });

  // ============ Users List ============
  describe('sso users list', () => {
    it('should list users with access', async () => {
      vi.mocked(client.get).mockResolvedValue({
        users: [
          {
            user_id: 'user-123',
            username: 'alice',
            email: 'alice@example.com',
            role: 'admin',
            granted_at: '2024-01-01T00:00:00Z',
            last_used_at: '2024-01-02T00:00:00Z',
          },
        ],
        pagination: { total: 1 },
      });

      await program.parseAsync(['node', 'test', 'sso', 'users', 'list', 'app-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123/users');
      expect(output.table).toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Total: 1 user(s)');
    });

    it('should list users with tenant option', async () => {
      vi.mocked(client.get).mockResolvedValue({ users: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'sso', 'users', 'list', 'app-123', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith('/v1/sso/apps/app-123/users?tenantId=acme');
    });

    it('should handle no users', async () => {
      vi.mocked(client.get).mockResolvedValue({ users: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'sso', 'users', 'list', 'app-123']);

      expect(output.info).toHaveBeenCalledWith('No users have access to this app');
    });

    it('should output JSON when --json flag is set', async () => {
      const users = [{ user_id: 'user-1', username: 'alice' }];
      vi.mocked(client.get).mockResolvedValue({ users, pagination: { total: 1 } });

      await program.parseAsync(['node', 'test', 'sso', 'users', 'list', 'app-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(users);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('App not found'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'users', 'list', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('App not found');
    });
  });

  // ============ Users Grant ============
  describe('sso users grant', () => {
    it('should grant user access with default role', async () => {
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'grant', 'app-123', 'user-456']);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps/app-123/users', {
        user_id: 'user-456',
        role: 'user',
      });
    });

    it('should grant user access with custom role', async () => {
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'grant', 'app-123', 'user-456', '--role', 'admin']);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps/app-123/users', {
        user_id: 'user-456',
        role: 'admin',
      });
    });

    it('should grant with tenant option', async () => {
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'grant', 'app-123', 'user-456', '--tenant', 'acme']);

      expect(client.post).toHaveBeenCalledWith('/v1/sso/apps/app-123/users?tenantId=acme', expect.any(Object));
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('User already has access'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'users', 'grant', 'app-123', 'user-456'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('User already has access');
    });
  });

  // ============ Users Revoke ============
  describe('sso users revoke', () => {
    it('should revoke user access with confirmation', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'revoke', 'app-123', 'user-456']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123/users/user-456');
    });

    it('should revoke with --yes flag', async () => {
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'revoke', 'app-123', 'user-456', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123/users/user-456');
    });

    it('should revoke with tenant option', async () => {
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'revoke', 'app-123', 'user-456', '--tenant', 'acme', '--yes']);

      expect(client.delete).toHaveBeenCalledWith('/v1/sso/apps/app-123/users/user-456?tenantId=acme');
    });

    it('should cancel when not confirmed', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'revoke', 'app-123', 'user-456']);

      expect(client.delete).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Revoke cancelled');
    });

    it('should handle errors', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.delete).mockRejectedValue(new Error('User not found'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'users', 'revoke', 'app-123', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('User not found');
    });
  });

  // ============ Users Set Role ============
  describe('sso users set-role', () => {
    it('should update user role', async () => {
      vi.mocked(client.patch).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'set-role', 'app-123', 'user-456', 'admin']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123/users/user-456', { role: 'admin' });
    });

    it('should update with tenant option', async () => {
      vi.mocked(client.patch).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'sso', 'users', 'set-role', 'app-123', 'user-456', 'viewer', '--tenant', 'acme']);

      expect(client.patch).toHaveBeenCalledWith('/v1/sso/apps/app-123/users/user-456?tenantId=acme', { role: 'viewer' });
    });

    it('should handle errors', async () => {
      vi.mocked(client.patch).mockRejectedValue(new Error('Invalid role'));

      await expect(program.parseAsync(['node', 'test', 'sso', 'users', 'set-role', 'app-123', 'user-456', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Invalid role');
    });
  });
});
