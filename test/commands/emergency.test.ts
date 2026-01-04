import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockDbInstance, mockPrompts } = vi.hoisted(() => ({
  mockDbInstance: {
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected to database' }),
    getUserStatus: vi.fn().mockResolvedValue({
      found: true,
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        role: 'user',
        status: 'active',
        failedAttempts: 0,
        totpEnabled: true,
        lockedUntil: null,
        lastLogin: new Date().toISOString(),
      },
    }),
    resetPassword: vi.fn().mockResolvedValue({ success: true, message: 'Password reset successfully' }),
    unlockUser: vi.fn().mockResolvedValue({ success: true, message: 'User unlocked successfully' }),
    disableTotp: vi.fn().mockResolvedValue({ success: true, message: 'TOTP disabled successfully' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  mockPrompts: {
    promptConfirm: vi.fn().mockResolvedValue(true),
    promptNewPassword: vi.fn().mockResolvedValue('newPassword123'),
  },
}));

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../src/lib/prompts.js', () => mockPrompts);

// Vitest 4.x requires mocks used as constructors to look like classes/functions
vi.mock('../../src/lib/db.js', () => ({
  isEmergencyDbAvailable: vi.fn().mockReturnValue(true),
  LocalDBClient: class MockLocalDBClient {
    testConnection = mockDbInstance.testConnection;
    getUserStatus = mockDbInstance.getUserStatus;
    resetPassword = mockDbInstance.resetPassword;
    unlockUser = mockDbInstance.unlockUser;
    disableTotp = mockDbInstance.disableTotp;
    close = mockDbInstance.close;
  },
  // Keep EmergencyDBClient for backwards compatibility with older code
  EmergencyDBClient: class MockEmergencyDBClient {
    testConnection = mockDbInstance.testConnection;
    getUserStatus = mockDbInstance.getUserStatus;
    resetPassword = mockDbInstance.resetPassword;
    unlockUser = mockDbInstance.unlockUser;
    disableTotp = mockDbInstance.disableTotp;
    close = mockDbInstance.close;
  },
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  section: vi.fn(),
  formatBool: vi.fn().mockImplementation(b => b ? 'yes' : 'no'),
  formatDate: vi.fn().mockReturnValue('2024-01-15'),
  formatStatus: vi.fn().mockImplementation(s => s),
}));

describe('emergency commands', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();

    program = new Command();
    program.exitOverride();

    const { registerEmergencyCommands } = await import('../../src/commands/emergency.js');
    registerEmergencyCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('emergency test-db', () => {
    it('should test database connection', async () => {
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'test-db']);

      expect(mockDbInstance.testConnection).toHaveBeenCalled();
      expect(info).toHaveBeenCalled();
    });
  });

  describe('emergency user-status', () => {
    it('should show user status from database', async () => {
      const { section, keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'user-status', 'alice']);

      expect(mockDbInstance.getUserStatus).toHaveBeenCalledWith('alice');
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'user-status', 'alice', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('emergency reset-password', () => {
    it('should reset password directly in database', async () => {
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'reset-password', 'alice', 'newSecretPass123']);

      expect(mockPrompts.promptConfirm).toHaveBeenCalled();
      expect(mockDbInstance.resetPassword).toHaveBeenCalledWith('alice', 'newSecretPass123');
      expect(info).toHaveBeenCalled();
    });

    it('should skip confirmation with --yes flag', async () => {
      await program.parseAsync(['node', 'test', 'emergency', 'reset-password', 'alice', 'newSecretPass123', '--yes']);

      expect(mockPrompts.promptConfirm).not.toHaveBeenCalled();
      expect(mockDbInstance.resetPassword).toHaveBeenCalled();
    });
  });

  describe('emergency unlock', () => {
    it('should unlock user directly in database', async () => {
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'unlock', 'alice', '--yes']);

      expect(mockDbInstance.unlockUser).toHaveBeenCalledWith('alice');
      expect(info).toHaveBeenCalled();
    });
  });

  describe('emergency disable-totp', () => {
    it('should disable TOTP directly in database', async () => {
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'emergency', 'disable-totp', 'alice', '--yes']);

      expect(mockDbInstance.disableTotp).toHaveBeenCalledWith('alice');
      expect(info).toHaveBeenCalled();
    });
  });
});
