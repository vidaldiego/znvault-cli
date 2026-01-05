// Path: znvault-cli/test/commands/apikey-managed.test.ts
// Unit tests for managed API key CLI commands

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

const mockManagedKey = {
  id: 'apk_managed123',
  tenant_id: 'acme',
  created_by: 'user-1',
  name: 'my-managed-key',
  description: 'Test managed key',
  prefix: 'znv_abc',
  expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  last_used: null,
  created_at: new Date().toISOString(),
  ip_allowlist: null,
  permissions: ['secret:read', 'secret:list'],
  conditions: null,
  created_by_username: 'admin',
  enabled: true,
  rotation_count: 0,
  last_rotation: null,
  is_managed: true,
  rotation_mode: 'scheduled' as const,
  rotation_interval: '24h',
  grace_period: '5m',
  notify_before: '1h',
  webhook_url: null,
  next_rotation_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  last_bound_at: null,
  grace_key_expires_at: null,
};

const mockBindResponse = {
  id: 'apk_managed123',
  key: 'znv_abc123def456ghi789',
  prefix: 'znv_abc',
  name: 'my-managed-key',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  gracePeriod: '5m',
  graceExpiresAt: null,
  rotationMode: 'scheduled' as const,
  permissions: ['secret:read', 'secret:list'],
  nextRotationAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  _notice: null,
};

vi.mock('../../src/lib/client.js', () => ({
  client: {
    createManagedApiKey: vi.fn().mockResolvedValue({
      apiKey: mockManagedKey,
      message: 'Managed API key created',
    }),
    listManagedApiKeys: vi.fn().mockResolvedValue({
      keys: [mockManagedKey],
      total: 1,
    }),
    getManagedApiKey: vi.fn().mockResolvedValue(mockManagedKey),
    bindManagedApiKey: vi.fn().mockResolvedValue(mockBindResponse),
    rotateManagedApiKey: vi.fn().mockResolvedValue({
      message: 'Key rotated successfully',
      nextRotationAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    updateManagedApiKeyConfig: vi.fn().mockResolvedValue({
      ...mockManagedKey,
      rotation_interval: '12h',
      grace_period: '10m',
    }),
    deleteManagedApiKey: vi.fn().mockResolvedValue(undefined),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  json: vi.fn(),
  keyValue: vi.fn(),
}));

describe('apikey managed commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
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

  describe('apikey managed list', () => {
    it('should list managed API keys', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'list']);

      expect(client.listManagedApiKeys).toHaveBeenCalled();
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'list', '--tenant', 'acme']);

      expect(client.listManagedApiKeys).toHaveBeenCalledWith('acme');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'list', '--json']);

      expect(json).toHaveBeenCalledWith({
        keys: [mockManagedKey],
        total: 1,
      });
    });
  });

  describe('apikey managed create', () => {
    it('should create a managed API key with scheduled rotation', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'create', 'my-key',
        '-p', 'secret:read',
        '-m', 'scheduled',
        '-i', '24h',
        '-g', '5m',
      ]);

      expect(client.createManagedApiKey).toHaveBeenCalledWith({
        name: 'my-key',
        description: undefined,
        expiresInDays: 365,
        permissions: ['secret:read'],
        tenantId: undefined,
        ipAllowlist: undefined,
        managed: {
          rotationMode: 'scheduled',
          rotationInterval: '24h',
          gracePeriod: '5m',
          notifyBefore: undefined,
          webhookUrl: undefined,
        },
      });
    });

    it('should create a managed API key with on-bind rotation', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'create', 'ci-key',
        '-p', 'secret:read,secret:list',
        '-m', 'on-bind',
        '-g', '2m',
      ]);

      expect(client.createManagedApiKey).toHaveBeenCalledWith({
        name: 'ci-key',
        description: undefined,
        expiresInDays: 365,
        permissions: ['secret:read', 'secret:list'],
        tenantId: undefined,
        ipAllowlist: undefined,
        managed: {
          rotationMode: 'on-bind',
          rotationInterval: undefined,
          gracePeriod: '2m',
          notifyBefore: undefined,
          webhookUrl: undefined,
        },
      });
    });

    it('should require --permissions flag', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'create', 'my-key', '-m', 'scheduled', '-i', '24h'])
      ).rejects.toThrow();

      expect(error).toHaveBeenCalledWith('--permissions is required. Use comma-separated permission strings.');
    });

    it('should require --rotation-mode flag', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'create', 'my-key', '-p', 'secret:read'])
      ).rejects.toThrow();

      expect(error).toHaveBeenCalledWith('--rotation-mode is required. Use: scheduled, on-use, or on-bind');
    });

    it('should require --rotation-interval for scheduled mode', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'create', 'my-key', '-p', 'secret:read', '-m', 'scheduled'])
      ).rejects.toThrow();

      expect(error).toHaveBeenCalledWith('--rotation-interval is required for scheduled rotation mode');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'create', 'my-key',
        '-p', 'secret:read',
        '-m', 'on-use',
        '--json',
      ]);

      expect(json).toHaveBeenCalledWith({
        apiKey: mockManagedKey,
        message: 'Managed API key created',
      });
    });
  });

  describe('apikey managed get', () => {
    it('should get managed API key details', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'get', 'my-managed-key']);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined);
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'get', 'my-managed-key', '--tenant', 'acme']);

      expect(client.getManagedApiKey).toHaveBeenCalledWith('my-managed-key', 'acme');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'get', 'my-managed-key', '--json']);

      expect(json).toHaveBeenCalledWith(mockManagedKey);
    });
  });

  describe('apikey managed bind', () => {
    it('should bind to managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'bind', 'my-managed-key']);

      expect(client.bindManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined);
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'bind', 'my-managed-key', '--tenant', 'acme']);

      expect(client.bindManagedApiKey).toHaveBeenCalledWith('my-managed-key', 'acme');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'bind', 'my-managed-key', '--json']);

      expect(json).toHaveBeenCalledWith(mockBindResponse);
    });
  });

  describe('apikey managed rotate', () => {
    it('should force rotate managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'rotate', 'my-managed-key']);

      expect(client.rotateManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined);
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'rotate', 'my-managed-key', '--tenant', 'acme']);

      expect(client.rotateManagedApiKey).toHaveBeenCalledWith('my-managed-key', 'acme');
    });
  });

  describe('apikey managed config', () => {
    it('should update rotation interval', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'config', 'my-managed-key', '-i', '12h']);

      expect(client.updateManagedApiKeyConfig).toHaveBeenCalledWith(
        'my-managed-key',
        {
          rotationInterval: '12h',
          gracePeriod: undefined,
          notifyBefore: undefined,
          webhookUrl: undefined,
        },
        undefined
      );
    });

    it('should update grace period', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'config', 'my-managed-key', '-g', '10m']);

      expect(client.updateManagedApiKeyConfig).toHaveBeenCalledWith(
        'my-managed-key',
        {
          rotationInterval: undefined,
          gracePeriod: '10m',
          notifyBefore: undefined,
          webhookUrl: undefined,
        },
        undefined
      );
    });

    it('should update multiple options', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'apikey', 'managed', 'config', 'my-managed-key',
        '-i', '12h',
        '-g', '10m',
        '--notify-before', '30m',
        '--webhook-url', 'https://example.com/webhook',
      ]);

      expect(client.updateManagedApiKeyConfig).toHaveBeenCalledWith(
        'my-managed-key',
        {
          rotationInterval: '12h',
          gracePeriod: '10m',
          notifyBefore: '30m',
          webhookUrl: 'https://example.com/webhook',
        },
        undefined
      );
    });

    it('should require at least one configuration option', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'apikey', 'managed', 'config', 'my-managed-key'])
      ).rejects.toThrow();

      expect(error).toHaveBeenCalledWith('At least one configuration option is required');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'config', 'my-managed-key', '-i', '12h', '--json']);

      expect(json).toHaveBeenCalledWith({
        ...mockManagedKey,
        rotation_interval: '12h',
        grace_period: '10m',
      });
    });
  });

  describe('apikey managed delete', () => {
    it('should delete managed API key', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'delete', 'my-managed-key']);

      expect(client.deleteManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined);
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'delete', 'my-managed-key', '--tenant', 'acme']);

      expect(client.deleteManagedApiKey).toHaveBeenCalledWith('my-managed-key', 'acme');
    });

    it('should skip confirmation with --force flag', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { warn } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'apikey', 'managed', 'delete', 'my-managed-key', '--force']);

      expect(warn).not.toHaveBeenCalled();
      expect(client.deleteManagedApiKey).toHaveBeenCalledWith('my-managed-key', undefined);
    });
  });
});
