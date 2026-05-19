// Path: znvault-cli/test/commands/apikey.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    getApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    rotateApiKey: vi.fn(),
    setApiKeyEnabled: vi.fn(),
    updateApiKeyPermissions: vi.fn(),
    updateApiKeyConditions: vi.fn(),
    getApiKeyPolicies: vi.fn(),
    attachApiKeyPolicy: vi.fn(),
    detachApiKeyPolicy: vi.fn(),
    getApiKeySelf: vi.fn(),
    rotateApiKeySelf: vi.fn(),
    listManagedApiKeys: vi.fn(),
    createManagedApiKey: vi.fn(),
    getManagedApiKey: vi.fn(),
    bindManagedApiKey: vi.fn(),
    rotateManagedApiKey: vi.fn(),
    updateManagedApiKeyConfig: vi.fn(),
    deleteManagedApiKey: vi.fn(),
  },
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
}));

// Mock process.exit
vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('apikey commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Sample test data
  const mockApiKey = {
    id: 'key-123',
    name: 'test-key',
    prefix: 'znv_abc',
    tenant_id: 'tenant-1',
    enabled: true,
    permissions: ['secret:read', 'secret:list'],
    description: 'Test API key',
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    created_by: 'user-123',
    created_by_username: 'admin',
    last_used: null,
    rotation_count: 0,
    last_rotation: null,
    ip_allowlist: null,
    conditions: null,
    is_managed: false,
    rotation_mode: null,
    rotation_interval_seconds: null,
  };

  const mockManagedKey = {
    id: 'managed-key-123',
    name: 'my-managed-key',
    prefix: 'znv_mng',
    tenant_id: 'tenant-1',
    enabled: true,
    permissions: ['secret:read'],
    description: 'Managed API key',
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    created_by: 'user-123',
    created_by_username: 'admin',
    rotation_mode: 'scheduled' as const,
    rotation_interval: '24h',
    rotation_interval_seconds: 86400,
    grace_period: '5m',
    next_rotation_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    last_bound_at: null,
    rotation_count: 0,
    last_rotation: null,
    notify_before: null,
    webhook_url: null,
    conditions: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();

    const { registerApiKeyCommands } = await import('../../src/commands/apikey.js');
    registerApiKeyCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ===== apikey list =====
  describe('apikey list', () => {
    it('should list API keys', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.listApiKeys).mockResolvedValue({
        items: [mockApiKey],
        expiringSoon: [],
        pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'list']);

      expect(client.listApiKeys).toHaveBeenCalledWith(undefined, { asSuperadmin: false });
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.listApiKeys).mockResolvedValue({
        items: [],
        expiringSoon: [],
        pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'list', '--tenant', 'tenant-1']);

      expect(client.listApiKeys).toHaveBeenCalledWith('tenant-1', { asSuperadmin: false });
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const response = {
        items: [mockApiKey],
        expiringSoon: [],
        pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      };
      vi.mocked(client.listApiKeys).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'apikey', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(response);
    });

    it('should show warning when no keys found', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { warn } = await import('../../src/lib/output.js');

      vi.mocked(client.listApiKeys).mockResolvedValue({
        items: [],
        expiringSoon: [],
        pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'list']);

      expect(warn).toHaveBeenCalledWith('No API keys found');
    });

    it('should use alias "ls"', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.listApiKeys).mockResolvedValue({
        items: [],
        expiringSoon: [],
        pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'ls']);

      expect(client.listApiKeys).toHaveBeenCalled();
    });
  });

  // ===== apikey create =====
  describe('apikey create', () => {
    it('should create API key with required options', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.createApiKey).mockResolvedValue({
        key: 'znv_abc123secret',
        apiKey: mockApiKey,
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'create', 'new-key',
        '--permissions', 'secret:read,secret:list'
      ]);

      expect(client.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
        name: 'new-key',
        permissions: ['secret:read', 'secret:list'],
        expiresInDays: 90,
      }));
    });

    it('should error when permissions not provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'create', 'new-key'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('--permissions is required. Use comma-separated permission strings.');
    });

    it('should pass all options', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.createApiKey).mockResolvedValue({
        key: 'znv_abc123secret',
        apiKey: mockApiKey,
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'create', 'new-key',
        '--permissions', 'secret:read',
        '--expires', '30',
        '--description', 'Test key',
        '--ip', '192.168.1.0/24,10.0.0.1',
        '--tenant', 'tenant-1'
      ]);

      expect(client.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
        name: 'new-key',
        permissions: ['secret:read'],
        expiresInDays: 30,
        description: 'Test key',
        ipAllowlist: ['192.168.1.0/24', '10.0.0.1'],
        tenantId: 'tenant-1',
      }));
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const response = {
        key: 'znv_abc123secret',
        apiKey: mockApiKey,
      };
      vi.mocked(client.createApiKey).mockResolvedValue(response);

      await program.parseAsync([
        'node', 'test', 'apikey', 'create', 'new-key',
        '--permissions', 'secret:read',
        '--json'
      ]);

      expect(json).toHaveBeenCalledWith(response);
    });
  });

  // ===== apikey show =====
  describe('apikey show', () => {
    it('should show API key details', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { keyValue } = await import('../../src/lib/output.js');

      vi.mocked(client.getApiKey).mockResolvedValue(mockApiKey);

      await program.parseAsync(['node', 'test', 'apikey', 'show', 'key-123']);

      expect(client.getApiKey).toHaveBeenCalledWith('key-123', undefined, { asSuperadmin: false });
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(client.getApiKey).mockResolvedValue(mockApiKey);

      await program.parseAsync(['node', 'test', 'apikey', 'show', 'key-123', '--json']);

      expect(json).toHaveBeenCalledWith(mockApiKey);
    });
  });

  // ===== apikey delete =====
  describe('apikey delete', () => {
    it('should delete API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.deleteApiKey).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'delete', 'key-123', '--force']);

      expect(client.deleteApiKey).toHaveBeenCalledWith('key-123', undefined, { asSuperadmin: false });
    });

    it('should use alias "rm"', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.deleteApiKey).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'rm', 'key-123', '--force']);

      expect(client.deleteApiKey).toHaveBeenCalledWith('key-123', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey rotate =====
  describe('apikey rotate', () => {
    it('should rotate API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.rotateApiKey).mockResolvedValue({
        key: 'znv_newkey123',
        apiKey: { ...mockApiKey, rotation_count: 1 },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'rotate', 'key-123']);

      expect(client.rotateApiKey).toHaveBeenCalledWith('key-123', undefined, undefined, { asSuperadmin: false });
    });

    it('should pass new name option', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.rotateApiKey).mockResolvedValue({
        key: 'znv_newkey123',
        apiKey: { ...mockApiKey, name: 'rotated-key', rotation_count: 1 },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'rotate', 'key-123', '--name', 'rotated-key']);

      expect(client.rotateApiKey).toHaveBeenCalledWith('key-123', 'rotated-key', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey enable =====
  describe('apikey enable', () => {
    it('should enable API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.setApiKeyEnabled).mockResolvedValue({ ...mockApiKey, enabled: true });

      await program.parseAsync(['node', 'test', 'apikey', 'enable', 'key-123']);

      expect(client.setApiKeyEnabled).toHaveBeenCalledWith('key-123', true, undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey disable =====
  describe('apikey disable', () => {
    it('should disable API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.setApiKeyEnabled).mockResolvedValue({ ...mockApiKey, enabled: false });

      await program.parseAsync(['node', 'test', 'apikey', 'disable', 'key-123']);

      expect(client.setApiKeyEnabled).toHaveBeenCalledWith('key-123', false, undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey update-permissions =====
  describe('apikey update-permissions', () => {
    it('should set permissions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.updateApiKeyPermissions).mockResolvedValue({
        ...mockApiKey,
        permissions: ['secret:read', 'secret:write'],
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'update-permissions', 'key-123',
        '--set', 'secret:read,secret:write'
      ]);

      expect(client.updateApiKeyPermissions).toHaveBeenCalledWith(
        'key-123',
        ['secret:read', 'secret:write'],
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should add permissions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getApiKey).mockResolvedValue(mockApiKey);
      vi.mocked(client.updateApiKeyPermissions).mockResolvedValue({
        ...mockApiKey,
        permissions: ['secret:read', 'secret:list', 'kms:encrypt'],
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'update-permissions', 'key-123',
        '--add', 'kms:encrypt'
      ]);

      expect(client.getApiKey).toHaveBeenCalledWith('key-123', undefined, { asSuperadmin: false });
      expect(client.updateApiKeyPermissions).toHaveBeenCalledWith(
        'key-123',
        ['secret:read', 'secret:list', 'kms:encrypt'],
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should remove permissions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getApiKey).mockResolvedValue(mockApiKey);
      vi.mocked(client.updateApiKeyPermissions).mockResolvedValue({
        ...mockApiKey,
        permissions: ['secret:read'],
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'update-permissions', 'key-123',
        '--remove', 'secret:list'
      ]);

      expect(client.updateApiKeyPermissions).toHaveBeenCalledWith(
        'key-123',
        ['secret:read'],
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should error when no option provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'update-permissions', 'key-123'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('At least one of --set, --add, or --remove is required');
    });
  });

  // ===== apikey update-conditions =====
  describe('apikey update-conditions', () => {
    it('should update IP conditions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.updateApiKeyConditions).mockResolvedValue({
        ...mockApiKey,
        conditions: { ip: ['192.168.1.0/24'] },
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'update-conditions', 'key-123',
        '--ip', '192.168.1.0/24'
      ]);

      expect(client.updateApiKeyConditions).toHaveBeenCalledWith(
        'key-123',
        { ip: ['192.168.1.0/24'] },
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should clear all conditions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.updateApiKeyConditions).mockResolvedValue({
        ...mockApiKey,
        conditions: {},
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'update-conditions', 'key-123',
        '--clear-all'
      ]);

      expect(client.updateApiKeyConditions).toHaveBeenCalledWith('key-123', {}, undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey list-policies =====
  describe('apikey list-policies', () => {
    it('should list policies attached to API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getApiKeyPolicies).mockResolvedValue({
        policies: [
          { policyId: 'policy-1', policyName: 'Test Policy', attachedAt: new Date().toISOString() },
        ],
      });

      await program.parseAsync(['node', 'test', 'apikey', 'list-policies', 'key-123']);

      expect(client.getApiKeyPolicies).toHaveBeenCalledWith('key-123', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey attach-policy =====
  describe('apikey attach-policy', () => {
    it('should attach policy to API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.attachApiKeyPolicy).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'attach-policy', 'key-123', 'policy-1']);

      expect(client.attachApiKeyPolicy).toHaveBeenCalledWith('key-123', 'policy-1', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey detach-policy =====
  describe('apikey detach-policy', () => {
    it('should detach policy from API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.detachApiKeyPolicy).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'detach-policy', 'key-123', 'policy-1']);

      expect(client.detachApiKeyPolicy).toHaveBeenCalledWith('key-123', 'policy-1', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey self =====
  describe('apikey self', () => {
    it('should show info about current API key', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { keyValue } = await import('../../src/lib/output.js');

      vi.mocked(client.getApiKeySelf).mockResolvedValue({
        apiKey: mockApiKey,
        expiresInDays: 90,
        isExpiringSoon: false,
      });

      await program.parseAsync(['node', 'test', 'apikey', 'self']);

      expect(client.getApiKeySelf).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });
  });

  // ===== apikey self-rotate =====
  describe('apikey self-rotate', () => {
    it('should rotate current API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.rotateApiKeySelf).mockResolvedValue({
        key: 'znv_newkey123',
        apiKey: { ...mockApiKey, rotation_count: 1 },
        expiresInDays: 90,
      });

      await program.parseAsync(['node', 'test', 'apikey', 'self-rotate']);

      expect(client.rotateApiKeySelf).toHaveBeenCalledWith(undefined);
    });
  });

  // ===== apikey managed list =====
  describe('apikey managed list', () => {
    it('should list managed API keys', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.listManagedApiKeys).mockResolvedValue({
        items: [mockManagedKey],
        pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'list']);

      expect(client.listManagedApiKeys).toHaveBeenCalledWith(undefined, { asSuperadmin: false });
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const response = {
        items: [mockManagedKey],
        pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      };
      vi.mocked(client.listManagedApiKeys).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(response);
    });
  });

  // ===== apikey managed create =====
  describe('apikey managed create', () => {
    it('should create managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.createManagedApiKey).mockResolvedValue({
        apiKey: mockManagedKey,
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'create', 'new-managed-key',
        '--permissions', 'secret:read',
        '--rotation-mode', 'scheduled',
        '--rotation-interval', '24h'
      ]);

      expect(client.createManagedApiKey).toHaveBeenCalledWith(expect.objectContaining({
        name: 'new-managed-key',
        permissions: ['secret:read'],
        managed: expect.objectContaining({
          rotationMode: 'scheduled',
          rotationInterval: '24h',
        }),
      }));
    });

    it('should error when permissions not provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync([
          'node', 'test', 'apikey', 'managed', 'create', 'new-key',
          '--rotation-mode', 'scheduled'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('--permissions is required. Use comma-separated permission strings.');
    });

    it('should error when rotation-mode not provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync([
          'node', 'test', 'apikey', 'managed', 'create', 'new-key',
          '--permissions', 'secret:read'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('--rotation-mode is required. Use: scheduled, on-use, or on-bind');
    });

    it('should error when rotation-interval not provided for scheduled mode', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync([
          'node', 'test', 'apikey', 'managed', 'create', 'new-key',
          '--permissions', 'secret:read',
          '--rotation-mode', 'scheduled'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('--rotation-interval is required for scheduled rotation mode');
    });
  });

  // ===== apikey managed get =====
  describe('apikey managed get', () => {
    it('should get managed API key details', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { keyValue } = await import('../../src/lib/output.js');

      vi.mocked(client.getManagedApiKey).mockResolvedValue(mockManagedKey);

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'get', 'my-managed-key']);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
      expect(keyValue).toHaveBeenCalled();
    });

    it('should use alias "show"', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getManagedApiKey).mockResolvedValue(mockManagedKey);

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'show', 'my-managed-key']);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey managed bind =====
  describe('apikey managed bind', () => {
    it('should bind to managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.bindManagedApiKey).mockResolvedValue({
        key: 'znv_mng_abc123',
        id: 'managed-key-123',
        name: 'my-managed-key',
        prefix: 'znv_mng',
        rotationMode: 'scheduled',
        nextRotationAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        gracePeriod: '5m',
        graceExpiresAt: null,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        permissions: ['secret:read'],
      });

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'bind', 'my-managed-key']);

      expect(client.bindManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('API Key:'));
    });
  });

  // ===== apikey managed rotate =====
  describe('apikey managed rotate', () => {
    it('should force rotate managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.rotateManagedApiKey).mockResolvedValue({
        message: 'Key rotated successfully',
        nextRotationAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'rotate', 'my-managed-key']);

      expect(client.rotateManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey managed config =====
  describe('apikey managed config', () => {
    it('should update managed API key config', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.updateManagedApiKeyConfig).mockResolvedValue(mockManagedKey);

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'config', 'my-managed-key',
        '--rotation-interval', '48h',
        '--grace-period', '10m'
      ]);

      expect(client.updateManagedApiKeyConfig).toHaveBeenCalledWith(
        'my-managed-key',
        {
          rotationInterval: '48h',
          gracePeriod: '10m',
          notifyBefore: undefined,
          webhookUrl: undefined,
        },
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should error when no config option provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'config', 'my-managed-key'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('At least one configuration option is required');
    });
  });

  // ===== apikey managed delete =====
  describe('apikey managed delete', () => {
    it('should delete managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.deleteManagedApiKey).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'delete', 'my-managed-key', '--force']);

      expect(client.deleteManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
    });

    it('should use alias "rm"', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.deleteManagedApiKey).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'rm', 'my-managed-key', '--force']);

      expect(client.deleteManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
    });
  });

  // ===== apikey managed permissions =====
  describe('apikey managed permissions', () => {
    it('should update managed key permissions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getManagedApiKey).mockResolvedValue(mockManagedKey);
      vi.mocked(client.updateApiKeyPermissions).mockResolvedValue({
        ...mockApiKey,
        permissions: ['secret:read', 'secret:write'],
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'permissions', 'my-managed-key',
        '--set', 'secret:read,secret:write'
      ]);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
      expect(client.updateApiKeyPermissions).toHaveBeenCalledWith(
        'managed-key-123',
        ['secret:read', 'secret:write'],
        undefined,
        { asSuperadmin: false }
      );
    });

    it('should error when no permission option provided', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'permissions', 'my-managed-key'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('At least one of --set, --add, or --remove is required');
    });
  });

  // ===== apikey managed conditions =====
  describe('apikey managed conditions', () => {
    it('should update managed key conditions', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.getManagedApiKey).mockResolvedValue(mockManagedKey);
      vi.mocked(client.updateApiKeyConditions).mockResolvedValue({
        ...mockApiKey,
        conditions: { ip: ['10.0.0.0/8'] },
      });

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'conditions', 'my-managed-key',
        '--ip', '10.0.0.0/8'
      ]);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined, { asSuperadmin: false });
      expect(client.updateApiKeyConditions).toHaveBeenCalledWith(
        'managed-key-123',
        { ip: ['10.0.0.0/8'] },
        undefined,
        { asSuperadmin: false }
      );
    });
  });

  // ===== Error handling =====
  describe('error handling', () => {
    it('should handle API errors on list', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(client.listApiKeys).mockRejectedValue(new Error('Network error'));

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'list'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Network error');
    });

    it('should handle API errors on create', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(client.createApiKey).mockRejectedValue(new Error('Invalid permissions'));

      await expect(
        program.parseAsync([
          'node', 'test', 'apikey', 'create', 'new-key',
          '--permissions', 'invalid:perm'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Invalid permissions');
    });
  });

  // ===== Alias tests =====
  describe('aliases', () => {
    it('should support api-key alias', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.listApiKeys).mockResolvedValue({
        items: [],
        expiringSoon: [],
        pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'api-key', 'list']);

      expect(client.listApiKeys).toHaveBeenCalled();
    });
  });
});
