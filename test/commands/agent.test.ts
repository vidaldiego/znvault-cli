// Path: znvault-cli/test/commands/agent.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock ora
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

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
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('agent commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Sample test data
  const mockAgent = {
    id: 'agent-123',
    tenantId: 'tenant-1',
    hostname: 'test-agent',
    version: '1.0.0',
    platform: 'linux',
    status: 'online',
    lastSeen: new Date().toISOString(),
    alertOnDisconnect: true,
    disconnectThresholdSeconds: 600,
    lastIpAddress: '192.168.1.100',
    subscriptions: {
      certificates: ['cert-1'],
      secrets: ['secret-1'],
      updates: null,
    },
    apiKey: {
      name: 'test-key',
      prefix: 'znv_',
      isManaged: false,
      rotationMode: null,
      rotationIntervalSeconds: null,
    },
  };

  const mockAgentDetail = {
    ...mockAgent,
    connectionState: 'healthy',
    lastConnectedAt: new Date().toISOString(),
    lastDisconnectedAt: null,
    disconnectReason: null,
    lastHealthyAt: new Date().toISOString(),
    lastDegradedAt: null,
    degradedReason: null,
    totalConnections: 5,
    totalEventsReceived: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockConnection = {
    agentId: 'agent-123',
    hostname: 'test-agent',
    tenantId: 'tenant-1',
    version: '1.0.0',
    platform: 'linux',
    connectedAt: new Date().toISOString(),
  };

  const mockReprovisionStatus = {
    agentId: 'agent-123',
    hostname: 'test-agent',
    connectionState: 'healthy',
    hasPendingToken: false,
    lastHealthyAt: new Date().toISOString(),
    lastDegradedAt: null,
    degradedReason: null,
  };

  const mockRegistrationToken = {
    token: 'znv_reg_abc123',
    prefix: 'znv_reg_',
    id: 'token-123',
    managedKeyName: 'my-managed-key',
    tenantId: 'tenant-1',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    description: 'Test token',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();

    const { registerAgentCommands } = await import('../../src/commands/agent.js');
    registerAgentCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ===== agent remote list =====
  describe('agent remote list', () => {
    it('should list agents with table output', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue({
        agents: [mockAgent],
        pagination: { totalItems: 1 },
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'list']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents?pageSize=100');
      expect(table).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        agents: [mockAgent],
        pagination: { totalItems: 1 },
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'list', '--status', 'online']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents?status=online&pageSize=100');
    });

    it('should filter by tenant', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        agents: [mockAgent],
        pagination: { totalItems: 1 },
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'list', '--tenant', 'tenant-1']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents?tenantId=tenant-1&pageSize=100');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      const response = {
        agents: [mockAgent],
        pagination: { totalItems: 1 },
      };
      vi.mocked(apiGet).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(response);
    });

    it('should show message when no agents found', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        agents: [],
        pagination: { totalItems: 0 },
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No agents registered');
    });

    it('should handle API errors', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'remote', 'list'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Network error');
    });
  });

  // ===== agent remote connections =====
  describe('agent remote connections', () => {
    it('should list active connections', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue({
        connections: [mockConnection],
        totalConnections: 1,
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'connections']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents/connections');
      expect(table).toHaveBeenCalled();
    });

    it('should filter by tenant', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        connections: [],
        totalConnections: 0,
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'connections', '--tenant', 'tenant-1']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents/connections?tenantId=tenant-1');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      const response = {
        connections: [mockConnection],
        totalConnections: 1,
      };
      vi.mocked(apiGet).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'connections', '--json']);

      expect(json).toHaveBeenCalledWith(response);
    });

    it('should show message when no connections', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({
        connections: [],
        totalConnections: 0,
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'connections']);

      expect(consoleSpy).toHaveBeenCalledWith('No active connections');
    });
  });

  // ===== agent remote status =====
  describe('agent remote status', () => {
    it('should show agent status details', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockImplementation((url: string) => {
        if (url.includes('/reprovision/status')) {
          return Promise.resolve(mockReprovisionStatus);
        }
        return Promise.resolve(mockAgentDetail);
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'status', 'agent-123']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents/agent-123');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent: test-agent'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockImplementation((url: string) => {
        if (url.includes('/reprovision/status')) {
          return Promise.resolve(mockReprovisionStatus);
        }
        return Promise.resolve(mockAgentDetail);
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'status', 'agent-123', '--json']);

      expect(json).toHaveBeenCalledWith({
        agent: mockAgentDetail,
        reprovision: mockReprovisionStatus,
      });
    });

    it('should handle reprovision status fetch failure gracefully', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockImplementation((url: string) => {
        if (url.includes('/reprovision/status')) {
          return Promise.reject(new Error('Not found'));
        }
        return Promise.resolve(mockAgentDetail);
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'status', 'agent-123']);

      // Should still show agent info even if reprovision status fails
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent: test-agent'));
    });
  });

  // ===== agent remote alerts =====
  describe('agent remote alerts', () => {
    it('should enable alerts', async () => {
      const { apiPatch } = await import('../../src/lib/mode.js');

      vi.mocked(apiPatch).mockResolvedValue({
        ...mockAgent,
        alertOnDisconnect: true,
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'alerts', 'agent-123', '--enable']);

      expect(apiPatch).toHaveBeenCalledWith('/v1/agents/agent-123/alerts', {
        alertOnDisconnect: true,
        disconnectThresholdSeconds: 600,
      });
    });

    it('should disable alerts', async () => {
      const { apiPatch } = await import('../../src/lib/mode.js');

      vi.mocked(apiPatch).mockResolvedValue({
        ...mockAgent,
        alertOnDisconnect: false,
      });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'alerts', 'agent-123', '--disable']);

      expect(apiPatch).toHaveBeenCalledWith('/v1/agents/agent-123/alerts', {
        alertOnDisconnect: false,
        disconnectThresholdSeconds: 600,
      });
    });

    it('should set custom threshold', async () => {
      const { apiPatch } = await import('../../src/lib/mode.js');

      vi.mocked(apiPatch).mockResolvedValue({
        ...mockAgent,
        alertOnDisconnect: true,
        disconnectThresholdSeconds: 300,
      });

      await program.parseAsync([
        'node', 'test', 'agent', 'remote', 'alerts', 'agent-123',
        '--enable', '--threshold', '300'
      ]);

      expect(apiPatch).toHaveBeenCalledWith('/v1/agents/agent-123/alerts', {
        alertOnDisconnect: true,
        disconnectThresholdSeconds: 300,
      });
    });

    it('should error when neither --enable nor --disable specified', async () => {
      const { error } = await import('../../src/lib/output.js');

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'remote', 'alerts', 'agent-123'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Specify --enable or --disable');
    });
  });

  // ===== agent remote delete =====
  describe('agent remote delete', () => {
    it('should delete agent with --yes flag', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');

      vi.mocked(apiDelete).mockResolvedValue({ success: true });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'delete', 'agent-123', '--yes']);

      expect(apiDelete).toHaveBeenCalledWith('/v1/agents/agent-123');
    });

    it('should handle delete errors', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiDelete).mockRejectedValue(new Error('Agent not found'));

      await expect(
        program.parseAsync(['node', 'test', 'agent', 'remote', 'delete', 'agent-123', '--yes'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Agent not found');
    });
  });

  // ===== agent remote reprovision create =====
  describe('agent remote reprovision create', () => {
    it('should generate reprovision token', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      const response = {
        token: 'reprov-token-123',
        agentId: 'agent-123',
        tenantId: 'tenant-1',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        reason: null,
        newApiKeyId: 'new-key-123',
      };
      vi.mocked(apiPost).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'reprovision', 'create', 'agent-123']);

      expect(apiPost).toHaveBeenCalledWith('/v1/agents/agent-123/reprovision', {
        reason: undefined,
        expiresIn: '15m',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Token: reprov-token-123'));
    });

    it('should pass reason and expires-in options', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        token: 'reprov-token-123',
        agentId: 'agent-123',
        tenantId: 'tenant-1',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        reason: 'Key compromised',
        newApiKeyId: 'new-key-123',
      });

      await program.parseAsync([
        'node', 'test', 'agent', 'remote', 'reprovision', 'create', 'agent-123',
        '--reason', 'Key compromised',
        '--expires-in', '1h'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/agents/agent-123/reprovision', {
        reason: 'Key compromised',
        expiresIn: '1h',
      });
    });
  });

  // ===== agent remote reprovision-status =====
  describe('agent remote reprovision-status', () => {
    it('should show reprovision status', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockReprovisionStatus);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'reprovision-status', 'agent-123']);

      expect(apiGet).toHaveBeenCalledWith('/v1/agents/agent-123/reprovision/status');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Agent: test-agent'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockReprovisionStatus);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'reprovision-status', 'agent-123', '--json']);

      expect(json).toHaveBeenCalledWith(mockReprovisionStatus);
    });

    it('should show pending token info when present', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      const statusWithToken = {
        ...mockReprovisionStatus,
        hasPendingToken: true,
        pendingToken: {
          id: 'token-123',
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          createdAt: new Date().toISOString(),
          createdBy: 'admin',
          reason: 'Key rotation',
        },
      };
      vi.mocked(apiGet).mockResolvedValue(statusWithToken);

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'reprovision-status', 'agent-123']);

      expect(consoleSpy).toHaveBeenCalledWith('Pending Reprovision Token:');
    });
  });

  // ===== agent remote cancel-reprovision =====
  describe('agent remote cancel-reprovision', () => {
    it('should cancel reprovision with --yes flag', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');

      vi.mocked(apiDelete).mockResolvedValue({ success: true });

      await program.parseAsync(['node', 'test', 'agent', 'remote', 'cancel-reprovision', 'agent-123', '--yes']);

      expect(apiDelete).toHaveBeenCalledWith('/v1/agents/agent-123/reprovision');
    });
  });

  // ===== agent token create =====
  describe('agent token create', () => {
    it('should create registration token', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue(mockRegistrationToken);

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'create',
        '--managed-key', 'my-managed-key'
      ]);

      expect(apiPost).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens',
        {
          expiresIn: '1h',
          description: undefined,
        }
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(mockRegistrationToken.token));
    });

    it('should pass optional parameters', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue(mockRegistrationToken);

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'create',
        '--managed-key', 'my-managed-key',
        '--expires', '24h',
        '--description', 'Production agent',
        '--tenant', 'tenant-1'
      ]);

      expect(apiPost).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens?tenantId=tenant-1',
        {
          expiresIn: '24h',
          description: 'Production agent',
        }
      );
    });
  });

  // ===== agent token list =====
  describe('agent token list', () => {
    it('should list registration tokens', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      const tokens = [{
        id: 'token-123',
        prefix: 'znv_reg_',
        managedKeyName: 'my-managed-key',
        tenantId: 'tenant-1',
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        usedAt: null,
        usedByIp: null,
        revokedAt: null,
        description: 'Test token',
        status: 'active' as const,
      }];

      vi.mocked(apiGet).mockResolvedValue({ tokens });

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'list',
        '--managed-key', 'my-managed-key'
      ]);

      expect(apiGet).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens'
      );
      expect(table).toHaveBeenCalled();
    });

    it('should include used tokens when flag set', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({ tokens: [] });

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'list',
        '--managed-key', 'my-managed-key',
        '--include-used'
      ]);

      expect(apiGet).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens?includeUsed=true'
      );
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      const response = { tokens: [] };
      vi.mocked(apiGet).mockResolvedValue(response);

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'list',
        '--managed-key', 'my-managed-key',
        '--json'
      ]);

      expect(json).toHaveBeenCalledWith(response);
    });
  });

  // ===== agent token revoke =====
  describe('agent token revoke', () => {
    it('should revoke registration token with --yes flag', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');

      vi.mocked(apiDelete).mockResolvedValue({ success: true });

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'revoke', 'token-123',
        '--managed-key', 'my-managed-key',
        '--yes'
      ]);

      expect(apiDelete).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens/token-123'
      );
    });

    it('should pass tenant query param', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');

      vi.mocked(apiDelete).mockResolvedValue({ success: true });

      await program.parseAsync([
        'node', 'test', 'agent', 'token', 'revoke', 'token-123',
        '--managed-key', 'my-managed-key',
        '--tenant', 'tenant-1',
        '--yes'
      ]);

      expect(apiDelete).toHaveBeenCalledWith(
        '/auth/api-keys/managed/my-managed-key/registration-tokens/token-123?tenantId=tenant-1'
      );
    });
  });

});
