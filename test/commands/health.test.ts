import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  health: vi.fn().mockResolvedValue({
    status: 'ok',
    version: '2.0.0',
    uptime: 3600,
    timestamp: new Date().toISOString(),
    database: { status: 'ok' },
  }),
  leaderHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    version: '2.0.0',
    uptime: 7200,
    timestamp: new Date().toISOString(),
    database: { status: 'ok' },
  }),
  clusterStatus: vi.fn().mockResolvedValue({
    enabled: true,
    nodeId: 'vault-1',
    isLeader: true,
    leaderNodeId: 'vault-1',
    nodes: [
      { nodeId: 'vault-1', host: '192.168.1.10', isLeader: true, isHealthy: true },
      { nodeId: 'vault-2', host: '192.168.1.11', isLeader: false, isHealthy: true },
    ],
  }),
  getLockdownStatus: vi.fn().mockResolvedValue({
    scope: 'SYSTEM',
    status: 'NORMAL',
    escalationCount: 0,
  }),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
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
  formatRelativeTime: vi.fn().mockReturnValue('1h ago'),
  formatStatus: vi.fn().mockImplementation(s => s),
  formatBool: vi.fn().mockImplementation(b => b ? 'yes' : 'no'),
  formatDate: vi.fn().mockReturnValue('2024-01-01'),
}));

vi.mock('../../src/lib/visual.js', () => ({
  statusBox: vi.fn().mockReturnValue('mocked status box'),
  box: vi.fn().mockReturnValue('mocked box'),
  nodeStatus: vi.fn().mockReturnValue('mocked node status'),
  cliBanner: vi.fn().mockReturnValue('mocked banner'),
  helpHint: vi.fn().mockReturnValue('mocked hint'),
}));

describe('health commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerHealthCommands } = await import('../../src/commands/health.js');
    registerHealthCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('health', () => {
    it('should display health status', async () => {
      const mode = await import('../../src/lib/mode.js');
      const visual = await import('../../src/lib/visual.js');

      await program.parseAsync(['node', 'test', 'health']);

      expect(mode.health).toHaveBeenCalled();
      expect(visual.statusBox).toHaveBeenCalled();
    });

    it('should get leader health with --leader flag', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'health', '--leader']);

      expect(mode.leaderHealth).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'health', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('should display comprehensive status', async () => {
      const mode = await import('../../src/lib/mode.js');
      const visual = await import('../../src/lib/visual.js');

      await program.parseAsync(['node', 'test', 'status']);

      expect(mode.health).toHaveBeenCalled();
      expect(mode.clusterStatus).toHaveBeenCalled();
      expect(mode.getLockdownStatus).toHaveBeenCalled();
      // Now uses visual module for boxed output
      expect(visual.statusBox).toHaveBeenCalled();
      expect(visual.nodeStatus).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'status', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });
});
