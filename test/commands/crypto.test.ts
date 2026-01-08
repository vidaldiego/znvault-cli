// Path: znvault-cli/test/commands/crypto.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

vi.mock('chalk', () => ({
  default: {
    green: vi.fn((s: string) => s),
    red: vi.fn((s: string) => s),
    bold: vi.fn((s: string) => s),
  },
}));

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  json: vi.fn(),
  formatDate: vi.fn().mockReturnValue('2024-01-01 12:00:00'),
}));

vi.mock('../../src/lib/visual.js', () => ({
  statusBox: vi.fn().mockReturnValue('mocked status box'),
  sectionHeader: vi.fn().mockReturnValue('mocked section header'),
}));

describe('crypto commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    // Mock process.exit
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    const { registerCryptoCommands } = await import('../../src/commands/crypto.js');
    registerCryptoCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
  });

  describe('crypto status', () => {
    it('should display crypto status for all mode', async () => {
      const { client } = await import('../../src/lib/client.js');
      const visual = await import('../../src/lib/visual.js');

      vi.mocked(client.get).mockResolvedValue({
        mode: 'all',
        otpUnsealRequired: true,
        unsealTimeoutMinutes: 15,
        tenantRootUserId: null,
        tenantRootUsername: '',
        activeGrantsCount: 0,
        isTenantRoot: false,
        hasCryptoGrant: false,
      });

      await program.parseAsync(['node', 'test', 'crypto', 'status']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin-crypto/status');
      expect(visual.statusBox).toHaveBeenCalledWith('CRYPTO ACCESS STATUS', expect.objectContaining({
        'Crypto Mode': expect.objectContaining({ value: 'All Admins' }),
        'OTP Unseal Required': expect.objectContaining({ value: 'Yes' }),
      }));
    });

    it('should display crypto status for root-delegated mode', async () => {
      const { client } = await import('../../src/lib/client.js');
      const visual = await import('../../src/lib/visual.js');

      vi.mocked(client.get).mockResolvedValue({
        mode: 'root-delegated',
        otpUnsealRequired: true,
        unsealTimeoutMinutes: 15,
        tenantRootUserId: 'user_123',
        tenantRootUsername: 'admin',
        activeGrantsCount: 3,
        isTenantRoot: true,
        hasCryptoGrant: false,
      });

      await program.parseAsync(['node', 'test', 'crypto', 'status']);

      expect(visual.statusBox).toHaveBeenCalledWith('CRYPTO ACCESS STATUS', expect.objectContaining({
        'Crypto Mode': expect.objectContaining({ value: 'Root Delegated' }),
        'Tenant Root': expect.objectContaining({ value: 'admin' }),
        'Active Grants': expect.objectContaining({ value: '3' }),
        'Your Status': expect.objectContaining({ value: 'Tenant Root', status: 'success' }),
      }));
    });

    it('should show disabled mode warning', async () => {
      const { client } = await import('../../src/lib/client.js');
      const visual = await import('../../src/lib/visual.js');

      vi.mocked(client.get).mockResolvedValue({
        mode: 'none',
        otpUnsealRequired: false,
        unsealTimeoutMinutes: 15,
        tenantRootUserId: null,
        tenantRootUsername: '',
        activeGrantsCount: 0,
        isTenantRoot: false,
        hasCryptoGrant: false,
      });

      await program.parseAsync(['node', 'test', 'crypto', 'status']);

      expect(visual.statusBox).toHaveBeenCalledWith('CRYPTO ACCESS STATUS', expect.objectContaining({
        'Crypto Mode': expect.objectContaining({ value: 'Disabled', status: 'warning' }),
      }));
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockStatus = {
        mode: 'all',
        otpUnsealRequired: true,
        unsealTimeoutMinutes: 15,
        isTenantRoot: false,
        hasCryptoGrant: false,
      };
      vi.mocked(client.get).mockResolvedValue(mockStatus);

      await program.parseAsync(['node', 'test', 'crypto', 'status', '--json']);

      expect(json).toHaveBeenCalledWith(mockStatus);
    });
  });

  describe('crypto list', () => {
    it('should list crypto grants', async () => {
      const { client } = await import('../../src/lib/client.js');
      const visual = await import('../../src/lib/visual.js');

      vi.mocked(client.get).mockResolvedValue({
        grants: [
          {
            id: 'grant_123',
            adminUserId: 'user_456',
            adminUsername: 'developer1',
            grantedByUserId: 'user_123',
            grantedByUsername: 'admin',
            grantedAt: '2024-01-01T10:00:00Z',
            isActive: true,
          },
        ],
        count: 1,
      });

      await program.parseAsync(['node', 'test', 'crypto', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin-crypto/grants');
      expect(visual.sectionHeader).toHaveBeenCalledWith('CRYPTO GRANTS (1)');
    });

    it('should show info message when no grants found', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      vi.mocked(client.get).mockResolvedValue({
        grants: [],
        count: 0,
      });

      await program.parseAsync(['node', 'test', 'crypto', 'list']);

      expect(info).toHaveBeenCalledWith('No active crypto grants found.');
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockResult = {
        grants: [],
        count: 0,
      };
      vi.mocked(client.get).mockResolvedValue(mockResult);

      await program.parseAsync(['node', 'test', 'crypto', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('crypto grant', () => {
    it('should grant crypto access to user', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      vi.mocked(client.post).mockResolvedValue({
        granted: true,
        grant: {
          id: 'grant_123',
          adminUserId: 'user_456',
          adminUsername: 'developer1',
          grantedByUserId: 'user_123',
          grantedByUsername: 'admin',
          grantedAt: '2024-01-01T10:00:00Z',
          isActive: true,
        },
      });

      await program.parseAsync(['node', 'test', 'crypto', 'grant', 'developer1']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin-crypto/grant', { username: 'developer1' });
      expect(success).toHaveBeenCalledWith(expect.stringContaining('developer1 can now access crypto operations'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockResult = {
        granted: true,
        grant: { id: 'grant_123', adminUsername: 'developer1' },
      };
      vi.mocked(client.post).mockResolvedValue(mockResult);

      await program.parseAsync(['node', 'test', 'crypto', 'grant', 'developer1', '--json']);

      expect(json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('crypto revoke', () => {
    it('should revoke crypto access with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { success } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.post).mockResolvedValue({ revoked: true });

      await program.parseAsync(['node', 'test', 'crypto', 'revoke', 'developer1']);

      expect(promptConfirm).toHaveBeenCalledWith('Revoke crypto access from developer1?', false);
      expect(client.post).toHaveBeenCalledWith('/v1/admin-crypto/revoke', { username: 'developer1' });
      expect(success).toHaveBeenCalledWith(expect.stringContaining('developer1 can no longer access crypto'));
    });

    it('should revoke without confirmation using --force', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      vi.mocked(client.post).mockResolvedValue({ revoked: true });

      await program.parseAsync(['node', 'test', 'crypto', 'revoke', 'developer1', '-f']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/admin-crypto/revoke', { username: 'developer1' });
    });

    it('should cancel when confirmation denied', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { info } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'crypto', 'revoke', 'developer1']);

      expect(client.post).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Revocation cancelled');
    });
  });

  describe('crypto transfer-root', () => {
    it('should transfer root with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { success, info, warn } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.post).mockResolvedValue({
        transferred: true,
        newRootUserId: 'user_456',
        newRootUsername: 'developer1',
      });

      await program.parseAsync(['node', 'test', 'crypto', 'transfer-root', 'developer1']);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('transfer the tenant root role'));
      expect(promptConfirm).toHaveBeenCalledWith('Transfer tenant root to developer1?', false);
      expect(client.post).toHaveBeenCalledWith('/v1/admin-crypto/transfer-root', { username: 'developer1' });
      expect(success).toHaveBeenCalledWith(expect.stringContaining('developer1 is now the tenant root'));
      expect(info).toHaveBeenCalledWith('You are no longer the tenant root.');
    });

    it('should transfer without confirmation using --force', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      vi.mocked(client.post).mockResolvedValue({
        transferred: true,
        newRootUserId: 'user_456',
        newRootUsername: 'developer1',
      });

      await program.parseAsync(['node', 'test', 'crypto', 'transfer-root', 'developer1', '-f']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/admin-crypto/transfer-root', { username: 'developer1' });
    });

    it('should cancel when confirmation denied', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { info } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'crypto', 'transfer-root', 'developer1']);

      expect(client.post).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Transfer cancelled');
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockResult = {
        transferred: true,
        newRootUserId: 'user_456',
        newRootUsername: 'developer1',
      };
      vi.mocked(client.post).mockResolvedValue(mockResult);

      await program.parseAsync(['node', 'test', 'crypto', 'transfer-root', 'developer1', '-f', '--json']);

      expect(json).toHaveBeenCalledWith(mockResult);
    });
  });
});
