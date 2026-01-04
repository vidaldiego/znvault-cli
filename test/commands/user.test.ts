// Path: znvault-cli/test/commands/user.test.ts

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

const mockUsers = [
  { id: 'user-1', username: 'alice', email: 'alice@example.com', role: 'user', status: 'active', tenantId: 'tenant-1', totpEnabled: false, failedAttempts: 0, lastLogin: null, createdAt: new Date().toISOString() },
  { id: 'user-2', username: 'bob', email: 'bob@example.com', role: 'admin', status: 'locked', tenantId: 'tenant-1', totpEnabled: true, failedAttempts: 3, lastLogin: new Date().toISOString(), createdAt: new Date().toISOString() },
];

// Mock mode.js - this is what the commands actually use
vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  listUsers: vi.fn().mockResolvedValue(mockUsers),
  getUser: vi.fn().mockResolvedValue({ id: 'user-1', username: 'alice', email: 'alice@example.com', role: 'user', status: 'active', tenantId: 'tenant-1', totpEnabled: false, failedAttempts: 0, lockedUntil: null, lastLogin: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  unlockUser: vi.fn().mockResolvedValue({ success: true, message: 'User unlocked' }),
  resetPassword: vi.fn().mockResolvedValue({ success: true, message: 'Password reset' }),
  disableTotp: vi.fn().mockResolvedValue({ success: true, message: 'TOTP disabled' }),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

// Mock client.js for API-only operations
vi.mock('../../src/lib/client.js', () => ({
  client: {
    createUser: vi.fn().mockResolvedValue({ id: 'new-user', username: 'newuser', email: null, role: 'user', status: 'active', tenantId: 'acme', createdAt: new Date().toISOString() }),
    updateUser: vi.fn().mockResolvedValue({ id: 'user-1', username: 'alice', status: 'active', updatedAt: new Date().toISOString() }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    resetUserPassword: vi.fn().mockResolvedValue({ success: true, message: 'Password reset' }),
    unlockUser: vi.fn().mockResolvedValue({ success: true, message: 'User unlocked' }),
    disableUserTotp: vi.fn().mockResolvedValue({ success: true, message: 'TOTP disabled' }),
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
  formatBool: vi.fn().mockImplementation(b => b ? 'yes' : 'no'),
}));

describe('user commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerUserCommands } = await import('../../src/commands/user.js');
    registerUserCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('user list', () => {
    it('should list all users', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table, info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'user', 'list']);

      expect(mode.listUsers).toHaveBeenCalledWith({ tenantId: undefined, role: undefined, status: undefined });
      expect(table).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 user(s)');
    });

    it('should filter by tenant', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'user', 'list', '--tenant', 'acme']);

      expect(mode.listUsers).toHaveBeenCalledWith({ tenantId: 'acme', role: undefined, status: undefined });
    });

    it('should filter by role', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'user', 'list', '--role', 'admin']);

      expect(mode.listUsers).toHaveBeenCalledWith({ tenantId: undefined, role: 'admin', status: undefined });
    });
  });

  describe('user create', () => {
    it('should create a new user', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'user', 'create', 'newuser', 'password123', '--tenant', 'acme']);

      expect(client.createUser).toHaveBeenCalledWith({
        username: 'newuser',
        password: 'password123',
        tenantId: 'acme',
        email: undefined,
        role: 'user', // defaults to 'user'
      });
    });

    it('should create user with all options', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'user', 'create', 'newuser', 'password123', '--tenant', 'acme', '--email', 'new@example.com', '--role', 'admin']);

      expect(client.createUser).toHaveBeenCalledWith({
        username: 'newuser',
        password: 'password123',
        tenantId: 'acme',
        email: 'new@example.com',
        role: 'admin',
      });
    });
  });

  describe('user get', () => {
    it('should get user details', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { section, keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-1']);

      expect(mode.getUser).toHaveBeenCalledWith('user-1');
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });
  });

  describe('user unlock', () => {
    it('should unlock user in API mode', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'user', 'unlock', 'user-2']);

      expect(client.unlockUser).toHaveBeenCalledWith('user-2');
    });
  });

  describe('user reset-password', () => {
    it('should reset user password in API mode', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'user', 'reset-password', 'user-1', 'newSecretPass123']);

      expect(client.resetUserPassword).toHaveBeenCalledWith('user-1', 'newSecretPass123');
    });
  });

  describe('user totp-disable', () => {
    it('should disable TOTP for user with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'user', 'totp-disable', 'user-1']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.disableUserTotp).toHaveBeenCalledWith('user-1');
    });

    it('should skip confirmation with --yes flag', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'user', 'totp-disable', 'user-1', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.disableUserTotp).toHaveBeenCalledWith('user-1');
    });
  });
});
