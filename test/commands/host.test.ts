// Path: znvault-cli/test/commands/host.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock mode (API client)
vi.mock('../../src/lib/mode.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  closeLocalClient: vi.fn(),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('host commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Sample test data matching server response format
  const mockHostListItem = {
    id: 'host-123',
    tenantId: 'tenant-1',
    hostname: 'web-server-1.example.com',
    description: 'Production web server',
    version: 3,
    managedKeyName: 'web-server-key',
    status: 'active' as const,
    lastPulledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    certTargetCount: 2,
    secretTargetCount: 5,
    linkedAgentCount: 1,
  };

  const mockHostConfig = {
    id: 'host-123',
    tenantId: 'tenant-1',
    hostname: 'web-server-1.example.com',
    description: 'Production web server',
    config: {
      targets: [
        {
          certId: 'cert-1',
          name: 'nginx-cert',
          outputs: { combined: '/etc/nginx/ssl/combined.pem' },
        },
      ],
      secretTargets: [
        {
          secretId: 'secret-1',
          name: 'db-creds',
          format: 'env',
          output: '/etc/app/.env',
        },
      ],
      plugins: [],
      globalReloadCmd: 'systemctl reload nginx',
      pollInterval: 300,
    },
    version: 3,
    managedKeyName: 'web-server-key',
    status: 'active' as const,
    lastPulledAt: new Date().toISOString(),
    lastPulledByAgentId: 'agent-456',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'admin',
    updatedBy: 'admin',
  };

  const mockStatsResponse = {
    total: 10,
    active: 7,
    disabled: 2,
    pending: 1,
  };

  const mockListResponse = {
    items: [mockHostListItem],
    pagination: {
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();

    const { registerHostCommands } = await import('../../src/commands/host/index.js');
    registerHostCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ===== host list =====
  describe('host list', () => {
    it('should list hosts with table output', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockListResponse);

      await program.parseAsync(['node', 'test', 'host', 'list']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts?limit=50&offset=0');
      expect(table).toHaveBeenCalled();
    });

    it('should show correct pagination info', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        items: [mockHostListItem],
        pagination: {
          total: 100,
          limit: 50,
          offset: 50,
          hasMore: true,
        },
      });

      await program.parseAsync(['node', 'test', 'host', 'list', '--page', '2']);

      expect(consoleSpy).toHaveBeenCalledWith('Found 100 host(s) (page 2/2)');
    });

    it('should filter by status', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockListResponse);

      await program.parseAsync(['node', 'test', 'host', 'list', '--status', 'active']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts?status=active&limit=50&offset=0');
    });

    it('should filter by tenant', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockListResponse);

      await program.parseAsync(['node', 'test', 'host', 'list', '--tenant', 'tenant-1']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts?tenantId=tenant-1&limit=50&offset=0');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockListResponse);

      await program.parseAsync(['node', 'test', 'host', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockListResponse);
    });

    it('should show message when no hosts found', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'host', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No host configurations found.');
    });

    it('should handle API errors', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      await expect(
        program.parseAsync(['node', 'test', 'host', 'list'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Network error');
    });

    it('should correctly convert page to offset', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockListResponse);

      await program.parseAsync(['node', 'test', 'host', 'list', '--page', '3', '--page-size', '25']);

      // Page 3 with pageSize 25 = offset 50
      expect(apiGet).toHaveBeenCalledWith('/v1/hosts?limit=25&offset=50');
    });
  });

  // ===== host stats =====
  describe('host stats', () => {
    it('should show host statistics', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockStatsResponse);

      await program.parseAsync(['node', 'test', 'host', 'stats']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts/stats');
      expect(consoleSpy).toHaveBeenCalledWith('Host Configuration Statistics');
      expect(consoleSpy).toHaveBeenCalledWith('  Total hosts:      10');
      expect(consoleSpy).toHaveBeenCalledWith('  Active:           7');
      expect(consoleSpy).toHaveBeenCalledWith('  Disabled:         2');
      expect(consoleSpy).toHaveBeenCalledWith('  Pending:          1');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockStatsResponse);

      await program.parseAsync(['node', 'test', 'host', 'stats', '--json']);

      expect(json).toHaveBeenCalledWith(mockStatsResponse);
    });

    it('should handle API errors', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockRejectedValue(new Error('Server error'));

      await expect(
        program.parseAsync(['node', 'test', 'host', 'stats'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Server error');
    });
  });

  // ===== host get =====
  describe('host get', () => {
    it('should get host details', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockHostConfig);

      await program.parseAsync(['node', 'test', 'host', 'get', 'web-server-1.example.com']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts/web-server-1.example.com');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockHostConfig);

      await program.parseAsync(['node', 'test', 'host', 'get', 'web-server-1.example.com', '--json']);

      expect(json).toHaveBeenCalledWith(mockHostConfig);
    });

    it('should handle not found errors', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockRejectedValue(new Error('Host not found'));

      await expect(
        program.parseAsync(['node', 'test', 'host', 'get', 'nonexistent.example.com'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Host not found');
    });
  });

  // ===== host create =====
  describe('host create', () => {
    it('should create host configuration', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue(mockHostConfig);

      await program.parseAsync(['node', 'test', 'host', 'create', 'new-host.example.com']);

      expect(apiPost).toHaveBeenCalledWith('/v1/hosts', expect.objectContaining({
        hostname: 'new-host.example.com',
      }));
    });

    it('should pass managed key option', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue(mockHostConfig);

      await program.parseAsync([
        'node', 'test', 'host', 'create', 'new-host.example.com',
        '--managed-key', 'my-key'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/hosts', expect.objectContaining({
        hostname: 'new-host.example.com',
        managedKeyName: 'my-key',
      }));
    });

    it('should pass description option', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue(mockHostConfig);

      await program.parseAsync([
        'node', 'test', 'host', 'create', 'new-host.example.com',
        '--description', 'My new server'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/hosts', expect.objectContaining({
        hostname: 'new-host.example.com',
        description: 'My new server',
      }));
    });
  });

  // ===== host delete =====
  describe('host delete', () => {
    it('should delete host with --yes flag', async () => {
      const { apiGet, apiDelete } = await import('../../src/lib/mode.js');

      // Mock getting the host first (delete command fetches before deleting)
      vi.mocked(apiGet).mockResolvedValue(mockHostConfig);
      vi.mocked(apiDelete).mockResolvedValue({ success: true });

      await program.parseAsync(['node', 'test', 'host', 'delete', 'web-server-1.example.com', '--yes']);

      expect(apiGet).toHaveBeenCalledWith('/v1/hosts/web-server-1.example.com');
      expect(apiDelete).toHaveBeenCalledWith('/v1/hosts/web-server-1.example.com');
    });

    it('should handle delete errors', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiDelete).mockRejectedValue(new Error('Host not found'));

      await expect(
        program.parseAsync(['node', 'test', 'host', 'delete', 'nonexistent.example.com', '--yes'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Host not found');
    });
  });

  // ===== host sync =====
  describe('host sync', () => {
    it('should sync host configuration', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        success: true,
        hostname: 'web-server-1.example.com',
        version: 4,
        linkedAgents: 1,
        notifiedAgents: 1,
      });

      await program.parseAsync(['node', 'test', 'host', 'sync', 'web-server-1.example.com']);

      expect(apiPost).toHaveBeenCalledWith('/v1/hosts/web-server-1.example.com/sync', { force: false });
    });

    it('should pass force flag', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        success: true,
        hostname: 'web-server-1.example.com',
        version: 4,
        linkedAgents: 1,
        notifiedAgents: 1,
      });

      await program.parseAsync(['node', 'test', 'host', 'sync', 'web-server-1.example.com', '--force']);

      expect(apiPost).toHaveBeenCalledWith('/v1/hosts/web-server-1.example.com/sync', { force: true });
    });
  });

  // ===== host bootstrap-token =====
  describe('host bootstrap-token', () => {
    it('should generate bootstrap token', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      const tokenResponse = {
        token: 'bootstrap-token-123',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        bootstrapUrl: 'https://vault.example.com/v1/hosts/bootstrap',
        hostConfigId: 'host-123',
        hostname: 'web-server-1.example.com',
      };
      vi.mocked(apiPost).mockResolvedValue(tokenResponse);

      await program.parseAsync(['node', 'test', 'host', 'bootstrap-token', 'web-server-1.example.com']);

      // Command sends expiresAt (ISO date string), default is 24h
      expect(apiPost).toHaveBeenCalledWith(
        '/v1/hosts/web-server-1.example.com/bootstrap-token',
        expect.objectContaining({ expiresAt: expect.any(String) })
      );
    });

    it('should pass custom expiry', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        token: 'bootstrap-token-123',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        bootstrapUrl: 'https://vault.example.com/v1/hosts/bootstrap',
        hostConfigId: 'host-123',
        hostname: 'web-server-1.example.com',
      });

      await program.parseAsync([
        'node', 'test', 'host', 'bootstrap-token', 'web-server-1.example.com',
        '--expires', '1h'
      ]);

      // Command parses duration and sends expiresAt
      expect(apiPost).toHaveBeenCalledWith(
        '/v1/hosts/web-server-1.example.com/bootstrap-token',
        expect.objectContaining({ expiresAt: expect.any(String) })
      );
    });
  });
});

// ===== Helper function tests =====
describe('host helpers', () => {
  describe('formatConfigSummary', () => {
    it('should format list item with counts', async () => {
      const { formatConfigSummary } = await import('../../src/commands/host/helpers.js');

      const listItem = {
        id: 'host-1',
        tenantId: 'tenant-1',
        hostname: 'test.example.com',
        version: 1,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        certTargetCount: 2,
        secretTargetCount: 3,
        linkedAgentCount: 1,
      };

      const result = formatConfigSummary(listItem);
      expect(result).toBe('2 cert(s), 3 secret(s)');
    });

    it('should format full config object', async () => {
      const { formatConfigSummary } = await import('../../src/commands/host/helpers.js');

      const config = {
        targets: [{ certId: 'cert-1', name: 'test', outputs: {} }],
        secretTargets: [
          { secretId: 's1', name: 'test1', format: 'env' as const },
          { secretId: 's2', name: 'test2', format: 'json' as const },
        ],
        plugins: [{ name: 'plugin-1', config: {}, enabled: true }],
        exec: { command: ['npm', 'start'], secrets: [] },
      };

      const result = formatConfigSummary(config);
      expect(result).toBe('1 cert(s), 2 secret(s), 1 plugin(s), exec mode');
    });

    it('should return empty for empty config', async () => {
      const { formatConfigSummary } = await import('../../src/commands/host/helpers.js');

      const listItem = {
        id: 'host-1',
        tenantId: 'tenant-1',
        hostname: 'test.example.com',
        version: 1,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        certTargetCount: 0,
        secretTargetCount: 0,
        linkedAgentCount: 0,
      };

      const result = formatConfigSummary(listItem);
      expect(result).toBe('empty');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format recent time as "just now"', async () => {
      const { formatRelativeTime } = await import('../../src/commands/host/helpers.js');

      const now = new Date().toISOString();
      const result = formatRelativeTime(now);
      expect(result).toBe('just now');
    });

    it('should format undefined as dash', async () => {
      const { formatRelativeTime } = await import('../../src/commands/host/helpers.js');

      const result = formatRelativeTime(undefined);
      expect(result).toBe('-');
    });

    it('should format minutes ago', async () => {
      const { formatRelativeTime } = await import('../../src/commands/host/helpers.js');

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const result = formatRelativeTime(fiveMinutesAgo);
      expect(result).toBe('5m ago');
    });

    it('should format hours ago', async () => {
      const { formatRelativeTime } = await import('../../src/commands/host/helpers.js');

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const result = formatRelativeTime(twoHoursAgo);
      expect(result).toBe('2h ago');
    });

    it('should format days ago', async () => {
      const { formatRelativeTime } = await import('../../src/commands/host/helpers.js');

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatRelativeTime(threeDaysAgo);
      expect(result).toBe('3d ago');
    });
  });

  describe('formatStatus', () => {
    it('should format active status with green color', async () => {
      const { formatStatus } = await import('../../src/commands/host/helpers.js');

      const result = formatStatus('active');
      expect(result).toContain('active');
      expect(result).toContain('\x1b[32m'); // green
    });

    it('should format disabled status with red color', async () => {
      const { formatStatus } = await import('../../src/commands/host/helpers.js');

      const result = formatStatus('disabled');
      expect(result).toContain('disabled');
      expect(result).toContain('\x1b[31m'); // red
    });

    it('should format pending status with yellow color', async () => {
      const { formatStatus } = await import('../../src/commands/host/helpers.js');

      const result = formatStatus('pending');
      expect(result).toContain('pending');
      expect(result).toContain('\x1b[33m'); // yellow
    });
  });

  describe('validateHostname', () => {
    it('should accept valid hostnames', async () => {
      const { validateHostname } = await import('../../src/commands/host/helpers.js');

      expect(validateHostname('web-server-1.example.com').valid).toBe(true);
      expect(validateHostname('localhost').valid).toBe(true);
      expect(validateHostname('my-host').valid).toBe(true);
    });

    it('should reject empty hostname', async () => {
      const { validateHostname } = await import('../../src/commands/host/helpers.js');

      const result = validateHostname('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Hostname is required');
    });

    it('should reject invalid hostname format', async () => {
      const { validateHostname } = await import('../../src/commands/host/helpers.js');

      const result = validateHostname('invalid_hostname!');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid hostname format');
    });
  });
});
