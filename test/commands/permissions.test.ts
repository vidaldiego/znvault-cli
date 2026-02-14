// Path: znvault-cli/test/commands/permissions.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPermissionsCommands } from '../../src/commands/permissions.js';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((s: string) => s),
    cyan: Object.assign(vi.fn((s: string) => s), { bold: vi.fn((s: string) => s) }),
    white: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: Object.assign(vi.fn((s: string) => s), { bold: vi.fn((s: string) => s) }),
    red: Object.assign(vi.fn((s: string) => s), { bold: vi.fn((s: string) => s) }),
    yellow: vi.fn((s: string) => s),
  },
}));

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    getPermissions: vi.fn(),
    validatePermissions: vi.fn(),
  },
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

import { client } from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';

describe('Permissions Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerPermissionsCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // ============ List Permissions ============
  describe('permissions list', () => {
    it('should list all permissions', async () => {
      const permissions = {
        permissions: [
          { permission: 'secret:read', description: 'Read secrets', category: 'secrets' },
          { permission: 'user:create', description: 'Create users', category: 'users' },
        ],
        categories: ['secrets', 'users'],
        total: 2,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(permissions);

      await program.parseAsync(['node', 'test', 'permissions', 'list']);

      expect(client.getPermissions).toHaveBeenCalledWith(undefined);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      const permissions = {
        permissions: [{ permission: 'secret:read', description: 'Read secrets', category: 'secrets' }],
        categories: ['secrets'],
        total: 1,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(permissions);

      await program.parseAsync(['node', 'test', 'permissions', 'list', '--category', 'secrets']);

      expect(client.getPermissions).toHaveBeenCalledWith('secrets');
    });

    it('should output JSON when --json flag is set', async () => {
      const permissions = { permissions: [], categories: [], total: 0 };
      vi.mocked(client.getPermissions).mockResolvedValue(permissions);

      await program.parseAsync(['node', 'test', 'permissions', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(permissions);
    });

    it('should handle errors', async () => {
      vi.mocked(client.getPermissions).mockRejectedValue(new Error('API Error'));

      await expect(program.parseAsync(['node', 'test', 'permissions', 'list'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('API Error');
    });
  });

  // ============ List Categories ============
  describe('permissions categories', () => {
    it('should list categories', async () => {
      const result = {
        permissions: [],
        categories: ['secrets', 'users', 'kms', 'policies'],
        total: 0,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'categories']);

      expect(client.getPermissions).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const result = { permissions: [], categories: ['secrets', 'users'], total: 0 };
      vi.mocked(client.getPermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'categories', '--json']);

      expect(output.json).toHaveBeenCalledWith({ categories: ['secrets', 'users'] });
    });

    it('should handle errors', async () => {
      vi.mocked(client.getPermissions).mockRejectedValue(new Error('API Error'));

      await expect(program.parseAsync(['node', 'test', 'permissions', 'categories'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('API Error');
    });
  });

  // ============ Validate Permissions ============
  describe('permissions validate', () => {
    it('should validate valid permissions', async () => {
      vi.mocked(client.validatePermissions).mockResolvedValue({
        valid: ['secret:read', 'user:create'],
        invalid: [],
        allValid: true,
      });

      await program.parseAsync(['node', 'test', 'permissions', 'validate', 'secret:read', 'user:create']);

      expect(client.validatePermissions).toHaveBeenCalledWith(['secret:read', 'user:create']);
    });

    it('should report invalid permissions', async () => {
      vi.mocked(client.validatePermissions).mockResolvedValue({
        valid: ['secret:read'],
        invalid: ['invalid:perm'],
        allValid: false,
      });

      await expect(program.parseAsync(['node', 'test', 'permissions', 'validate', 'secret:read', 'invalid:perm'])).rejects.toThrow('process.exit(1)');
    });

    it('should output JSON when --json flag is set', async () => {
      const result = { valid: ['secret:read'], invalid: [], allValid: true };
      vi.mocked(client.validatePermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'validate', 'secret:read', '--json']);

      expect(output.json).toHaveBeenCalledWith(result);
    });

    it('should handle errors', async () => {
      vi.mocked(client.validatePermissions).mockRejectedValue(new Error('Validation failed'));

      await expect(program.parseAsync(['node', 'test', 'permissions', 'validate', 'secret:read'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Validation failed');
    });
  });

  // ============ Search Permissions ============
  describe('permissions search', () => {
    it('should search permissions', async () => {
      const result = {
        permissions: [
          { permission: 'secret:read', description: 'Read secrets', category: 'secrets' },
          { permission: 'secret:write', description: 'Write secrets', category: 'secrets' },
        ],
        categories: ['secrets'],
        total: 2,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'search', 'secret']);

      expect(client.getPermissions).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should handle no matches', async () => {
      const result = {
        permissions: [{ permission: 'user:create', description: 'Create users', category: 'users' }],
        categories: ['users'],
        total: 1,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'search', 'nomatch']);

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const result = {
        permissions: [{ permission: 'secret:read', description: 'Read', category: 'secrets' }],
        categories: ['secrets'],
        total: 1,
      };
      vi.mocked(client.getPermissions).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'permissions', 'search', 'secret', '--json']);

      expect(output.json).toHaveBeenCalledWith({ permissions: expect.any(Array), total: expect.any(Number) });
    });

    it('should handle errors', async () => {
      vi.mocked(client.getPermissions).mockRejectedValue(new Error('Search failed'));

      await expect(program.parseAsync(['node', 'test', 'permissions', 'search', 'test'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Search failed');
    });
  });
});
