// Path: znvault-cli/test/commands/lockdown.test.ts

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

const mockLockdownStatus = {
  scope: 'SYSTEM',
  status: 'NORMAL',
  escalationCount: 0,
  reason: null,
  triggeredAt: null,
  triggeredBy: null,
  tenantId: null,
};

const mockLockdownHistory = [
  { id: 'lh-1', ts: new Date().toISOString(), previousStatus: 'NORMAL', newStatus: 'ALERT', transitionReason: 'Security threat detected', changedByUserId: 'admin', changedBySystem: false },
  { id: 'lh-2', ts: new Date().toISOString(), previousStatus: 'ALERT', newStatus: 'NORMAL', transitionReason: 'Cleared by admin', changedByUserId: 'admin', changedBySystem: false },
];

const mockThreats = [
  { id: 'th-1', ts: new Date().toISOString(), category: 'AUTH_FAILURE', signal: 'failed_login', ip: '192.168.1.100', endpoint: '/auth/login', suggestedLevel: 1, escalated: false },
];

// Mock mode.js - this is what the commands actually use
vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  getLockdownStatus: vi.fn().mockResolvedValue(mockLockdownStatus),
  getLockdownHistory: vi.fn().mockResolvedValue(mockLockdownHistory),
  getThreats: vi.fn().mockResolvedValue(mockThreats),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

// Mock client.js for API-only operations
vi.mock('../../src/lib/client.js', () => ({
  client: {
    triggerLockdown: vi.fn().mockResolvedValue({
      success: true,
      status: 'ALERT',
      message: 'Lockdown triggered',
    }),
    clearLockdown: vi.fn().mockResolvedValue({
      success: true,
      previousStatus: 'ALERT',
      message: 'Lockdown cleared',
    }),
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
  formatDate: vi.fn().mockReturnValue('2024-01-15'),
  formatStatus: vi.fn().mockImplementation(s => s),
}));

describe('lockdown commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerLockdownCommands } = await import('../../src/commands/lockdown.js');
    registerLockdownCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('lockdown status', () => {
    it('should display lockdown status', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { section, keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'status']);

      expect(mode.getLockdownStatus).toHaveBeenCalled();
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'status', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('lockdown trigger', () => {
    it('should trigger lockdown with level and reason', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'trigger', '2', 'Security threat detected']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.triggerLockdown).toHaveBeenCalledWith(2, 'Security threat detected');
    });

    it('should skip confirmation with --yes flag', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'trigger', '3', 'Emergency lockdown', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.triggerLockdown).toHaveBeenCalledWith(3, 'Emergency lockdown');
    });
  });

  describe('lockdown clear', () => {
    it('should clear lockdown with reason', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'clear', 'Threat resolved', '--yes']);

      expect(client.clearLockdown).toHaveBeenCalledWith('Threat resolved');
    });
  });

  describe('lockdown history', () => {
    it('should display lockdown history', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'history']);

      expect(mode.getLockdownHistory).toHaveBeenCalledWith(50);
      expect(table).toHaveBeenCalled();
    });

    it('should respect --limit flag', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'history', '--limit', '10']);

      expect(mode.getLockdownHistory).toHaveBeenCalledWith(10);
    });
  });

  describe('lockdown threats', () => {
    it('should display recent threats', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'threats']);

      expect(mode.getThreats).toHaveBeenCalledWith({ category: undefined, since: undefined, limit: 100 });
      expect(table).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'lockdown', 'threats', '--category', 'AUTH_FAILURE']);

      expect(mode.getThreats).toHaveBeenCalledWith({ category: 'AUTH_FAILURE', since: undefined, limit: 100 });
    });
  });
});
