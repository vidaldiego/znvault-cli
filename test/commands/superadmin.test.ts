// Path: znvault-cli/test/commands/superadmin.test.ts

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
  promptPassword: vi.fn().mockResolvedValue('newPassword123'),
  promptNewPassword: vi.fn().mockResolvedValue('newPassword123'),
}));

const mockSuperadmins = [
  { id: 'sa-1', username: 'superadmin', email: 'super@example.com', status: 'active', totpEnabled: false, failedAttempts: 0, lastLogin: null, createdAt: new Date().toISOString() },
  { id: 'sa-2', username: 'backup-admin', email: 'backup@example.com', status: 'disabled', totpEnabled: true, failedAttempts: 2, lastLogin: new Date().toISOString(), createdAt: new Date().toISOString() },
];

// Mock mode.js - this is what the commands actually use
vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  listSuperadmins: vi.fn().mockResolvedValue(mockSuperadmins),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

// Mock client.js for API-only operations
vi.mock('../../src/lib/client.js', () => ({
  client: {
    createSuperadmin: vi.fn().mockResolvedValue({ id: 'new-sa', username: 'newsuperadmin', email: null, status: 'active', createdAt: new Date().toISOString() }),
    resetSuperadminPassword: vi.fn().mockResolvedValue({ success: true, message: 'Password reset' }),
    unlockSuperadmin: vi.fn().mockResolvedValue({ success: true, message: 'Superadmin unlocked' }),
    disableSuperadmin: vi.fn().mockResolvedValue({ success: true, message: 'Superadmin disabled' }),
    enableSuperadmin: vi.fn().mockResolvedValue({ success: true, message: 'Superadmin enabled' }),
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
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  formatRelativeTime: vi.fn().mockReturnValue('1m ago'),
  formatDate: vi.fn().mockReturnValue('2024-01-15'),
  formatStatus: vi.fn().mockImplementation(s => s),
}));

describe('superadmin commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerSuperadminCommands } = await import('../../src/commands/superadmin.js');
    registerSuperadminCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('superadmin list', () => {
    it('should list all superadmins', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table, info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'list']);

      expect(mode.listSuperadmins).toHaveBeenCalled();
      expect(table).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 superadmin(s)');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'list', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('superadmin create', () => {
    it('should create a new superadmin', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'create', 'newsuperadmin', 'password123']);

      expect(client.createSuperadmin).toHaveBeenCalledWith({
        username: 'newsuperadmin',
        password: 'password123',
        email: undefined,
      });
    });

    it('should create superadmin with email', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'create', 'newsuperadmin', 'password123', '--email', 'new@example.com']);

      expect(client.createSuperadmin).toHaveBeenCalledWith({
        username: 'newsuperadmin',
        password: 'password123',
        email: 'new@example.com',
      });
    });
  });

  describe('superadmin reset-password', () => {
    it('should reset superadmin password', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'reset-password', 'superadmin', 'newSecretPass123']);

      expect(client.resetSuperadminPassword).toHaveBeenCalledWith('superadmin', 'newSecretPass123');
    });
  });

  describe('superadmin unlock', () => {
    it('should unlock superadmin', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'unlock', 'backup-admin']);

      expect(client.unlockSuperadmin).toHaveBeenCalledWith('backup-admin');
    });
  });

  describe('superadmin disable', () => {
    it('should disable superadmin with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'disable', 'backup-admin']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.disableSuperadmin).toHaveBeenCalledWith('backup-admin');
    });

    it('should skip confirmation with --yes flag', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'disable', 'backup-admin', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.disableSuperadmin).toHaveBeenCalledWith('backup-admin');
    });
  });

  describe('superadmin enable', () => {
    it('should enable superadmin', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'superadmin', 'enable', 'backup-admin']);

      expect(client.enableSuperadmin).toHaveBeenCalledWith('backup-admin');
    });
  });
});
