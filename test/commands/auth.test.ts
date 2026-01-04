// Path: znvault-cli/test/commands/auth.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptUsername: vi.fn().mockResolvedValue('admin'),
  promptPassword: vi.fn().mockResolvedValue('password'),
  promptTotp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/client.js', () => ({
  client: {
    login: vi.fn().mockResolvedValue({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      expiresIn: 3600,
      user: { id: '123', username: 'admin', role: 'superadmin', tenantId: null },
    }),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({
    userId: '123',
    username: 'admin',
    role: 'superadmin',
    tenantId: null,
    expiresAt: Date.now() + 3600000,
  }),
  clearCredentials: vi.fn(),
  clearApiKey: vi.fn(),
  setConfigValue: vi.fn(),
  getAllConfig: vi.fn().mockReturnValue({
    url: 'https://localhost:8443',
    insecure: false,
    timeout: 30000,
  }),
  getConfigPath: vi.fn().mockReturnValue('/path/to/config'),
  getStoredApiKey: vi.fn().mockReturnValue(null),
  getActiveProfileName: vi.fn().mockReturnValue('default'),
  saveCredentials: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
}));

describe('auth commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerAuthCommands } = await import('../../src/commands/auth.js');
    registerAuthCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should call client.login with provided credentials', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'login', '-u', 'admin', '-p', 'password']);

      expect(client.login).toHaveBeenCalledWith('admin', 'password', undefined);
    });
  });

  describe('logout', () => {
    it('should clear credentials', async () => {
      const { clearCredentials } = await import('../../src/lib/config.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'logout']);

      expect(clearCredentials).toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith('Logged out successfully (profile: default)');
    });
  });

  describe('whoami', () => {
    it('should display current user info', async () => {
      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami']);

      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('config', () => {
    it('should set config value', async () => {
      const { setConfigValue } = await import('../../src/lib/config.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'config', 'set', 'url', 'https://example.com']);

      expect(setConfigValue).toHaveBeenCalledWith('url', 'https://example.com');
      expect(success).toHaveBeenCalled();
    });

    it('should get all config values', async () => {
      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'config', 'get']);

      expect(keyValue).toHaveBeenCalled();
    });

    it('should show config path', async () => {
      await program.parseAsync(['node', 'test', 'config', 'path']);

      expect(consoleSpy).toHaveBeenCalledWith('/path/to/config');
    });
  });
});
