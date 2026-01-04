import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  clusterStatus: vi.fn().mockResolvedValue({
    enabled: true,
    nodeId: 'vault-1',
    isLeader: true,
    leaderNodeId: 'vault-1',
    nodes: [
      { nodeId: 'vault-1', host: '192.168.1.10', port: 8443, isLeader: true, isHealthy: true, lastHeartbeat: new Date().toISOString() },
      { nodeId: 'vault-2', host: '192.168.1.11', port: 8443, isLeader: false, isHealthy: true, lastHeartbeat: new Date().toISOString() },
    ],
  }),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/client.js', () => ({
  client: {
    clusterTakeover: vi.fn().mockResolvedValue({ success: true, message: 'Takeover successful', nodeId: 'vault-1' }),
    clusterPromote: vi.fn().mockResolvedValue({ success: true, message: 'Promotion successful' }),
    clusterRelease: vi.fn().mockResolvedValue({ success: true, message: 'Leadership released' }),
    clusterMaintenance: vi.fn().mockResolvedValue({ success: true, maintenanceMode: true }),
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
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  formatRelativeTime: vi.fn().mockReturnValue('1m ago'),
  formatStatus: vi.fn().mockImplementation(s => s),
  formatBool: vi.fn().mockImplementation(b => b ? 'yes' : 'no'),
}));

describe('cluster commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerClusterCommands } = await import('../../src/commands/cluster.js');
    registerClusterCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('cluster status', () => {
    it('should display cluster status', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { keyValue, table, section } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'cluster', 'status']);

      expect(mode.clusterStatus).toHaveBeenCalled();
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
      expect(table).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'cluster', 'status', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('cluster takeover', () => {
    it('should perform takeover with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'cluster', 'takeover']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.clusterTakeover).toHaveBeenCalled();
    });

    it('should skip confirmation with --yes flag', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'cluster', 'takeover', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.clusterTakeover).toHaveBeenCalled();
    });
  });

  describe('cluster promote', () => {
    it('should promote specified node', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'cluster', 'promote', 'vault-2', '--yes']);

      expect(client.clusterPromote).toHaveBeenCalledWith('vault-2');
    });
  });

  describe('cluster release', () => {
    it('should release leadership', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'cluster', 'release', '--yes']);

      expect(client.clusterRelease).toHaveBeenCalled();
    });
  });

  describe('cluster maintenance', () => {
    it('should enable maintenance mode', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'cluster', 'maintenance', 'enable', '--yes']);

      expect(client.clusterMaintenance).toHaveBeenCalledWith(true);
    });

    it('should disable maintenance mode', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'cluster', 'maintenance', 'disable', '--yes']);

      expect(client.clusterMaintenance).toHaveBeenCalledWith(false);
    });
  });
});
