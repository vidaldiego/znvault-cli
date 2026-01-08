// Path: znvault-cli/test/commands/device.test.ts

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

describe('device commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    // Mock process.exit
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    const { registerDeviceCommands } = await import('../../src/commands/device.js');
    registerDeviceCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
  });

  describe('device list', () => {
    it('should list enrolled devices', async () => {
      const { client } = await import('../../src/lib/client.js');
      const visual = await import('../../src/lib/visual.js');

      vi.mocked(client.get).mockResolvedValue({
        devices: [
          {
            id: 'dev_123',
            deviceName: 'MacBook Pro',
            deviceType: 'secure_enclave',
            deviceFingerprint: 'fp_abc',
            publicKeyAlgorithm: 'ES256',
            osType: 'macOS',
            osVersion: '14.0',
            clientVersion: '1.0.0',
            isActive: true,
            lastUsed: '2024-01-01T10:00:00Z',
            useCount: 5,
            enrolledAt: '2023-12-01T10:00:00Z',
          },
        ],
        count: 1,
      });

      await program.parseAsync(['node', 'test', 'device', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/devices');
      expect(visual.sectionHeader).toHaveBeenCalledWith('ENROLLED DEVICES (1)');
    });

    it('should include revoked devices with --all flag', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.get).mockResolvedValue({
        devices: [],
        count: 0,
      });

      await program.parseAsync(['node', 'test', 'device', 'list', '--all']);

      expect(client.get).toHaveBeenCalledWith('/v1/devices?all=true');
    });

    it('should show info message when no devices found', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      vi.mocked(client.get).mockResolvedValue({
        devices: [],
        count: 0,
      });

      await program.parseAsync(['node', 'test', 'device', 'list']);

      expect(info).toHaveBeenCalledWith('No enrolled devices found.');
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockResult = {
        devices: [
          {
            id: 'dev_123',
            deviceName: 'MacBook Pro',
            deviceType: 'secure_enclave',
            isActive: true,
          },
        ],
        count: 1,
      };
      vi.mocked(client.get).mockResolvedValue(mockResult);

      await program.parseAsync(['node', 'test', 'device', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('device revoke', () => {
    it('should revoke device with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { success } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.delete).mockResolvedValue({ revoked: true, deviceId: 'dev_123' });

      await program.parseAsync(['node', 'test', 'device', 'revoke', 'dev_123']);

      expect(promptConfirm).toHaveBeenCalledWith('Revoke device dev_123?', false);
      expect(client.delete).toHaveBeenCalledWith('/v1/devices/dev_123');
      expect(success).toHaveBeenCalledWith(expect.stringContaining('dev_123 has been revoked'));
    });

    it('should revoke device without confirmation using --force', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      vi.mocked(client.delete).mockResolvedValue({ revoked: true, deviceId: 'dev_123' });

      await program.parseAsync(['node', 'test', 'device', 'revoke', 'dev_123', '--force']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/devices/dev_123');
    });

    it('should include reason when provided', async () => {
      const { client } = await import('../../src/lib/client.js');

      vi.mocked(client.delete).mockResolvedValue({ revoked: true, deviceId: 'dev_123' });

      await program.parseAsync(['node', 'test', 'device', 'revoke', 'dev_123', '-f', '-r', 'Lost device']);

      expect(client.delete).toHaveBeenCalledWith('/v1/devices/dev_123?reason=Lost%20device');
    });

    it('should cancel when confirmation denied', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');
      const { info } = await import('../../src/lib/output.js');

      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'device', 'revoke', 'dev_123']);

      expect(client.delete).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Revocation cancelled');
    });

    it('should output JSON when --json flag is used', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      const mockResult = { revoked: true, deviceId: 'dev_123' };
      vi.mocked(client.delete).mockResolvedValue(mockResult);

      await program.parseAsync(['node', 'test', 'device', 'revoke', 'dev_123', '-f', '--json']);

      expect(json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('device enroll', () => {
    it('should show instructions for WebAuthn enrollment', async () => {
      const { warn, info } = await import('../../src/lib/output.js');

      await expect(program.parseAsync(['node', 'test', 'device', 'enroll'])).rejects.toThrow('process.exit');

      expect(warn).toHaveBeenCalledWith('Device enrollment requires WebAuthn/Passkey support.');
      expect(info).toHaveBeenCalledWith('Please use the dashboard to enroll a device:');
    });
  });
});
