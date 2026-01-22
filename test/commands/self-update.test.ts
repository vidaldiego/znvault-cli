// Path: znvault-cli/test/commands/self-update.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSelfUpdateCommands } from '../../src/commands/self-update.js';

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    dim: vi.fn((s: string) => s),
  },
}));

// Mock node:child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'close') callback(0);
    }),
  })),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock cli-update
vi.mock('../../src/lib/cli-update.js', () => ({
  checkForUpdate: vi.fn(),
  performUpdate: vi.fn(),
  getCurrentVersion: vi.fn(),
  clearUpdateCache: vi.fn(),
}));

// Mock config
vi.mock('../../src/lib/config.js', () => ({
  getPlugins: vi.fn(),
  getConfigPath: vi.fn(() => '/home/user/.config/znvault/config.json'),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

import { checkForUpdate, performUpdate, getCurrentVersion, clearUpdateCache } from '../../src/lib/cli-update.js';
import { getPlugins } from '../../src/lib/config.js';
import * as output from '../../src/lib/output.js';

describe('Self-Update Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerSelfUpdateCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // ============ Self-Update Check ============
  describe('self-update --check', () => {
    it('should check for updates when up to date', async () => {
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: false,
        currentVersion: '2.16.0',
        latestVersion: '2.16.0',
      });
      vi.mocked(getPlugins).mockReturnValue([]);

      await program.parseAsync(['node', 'test', 'self-update', '--check']);

      expect(checkForUpdate).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should show update available', async () => {
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: true,
        currentVersion: '2.15.0',
        latestVersion: '2.16.0',
      });
      vi.mocked(getPlugins).mockReturnValue([]);

      await program.parseAsync(['node', 'test', 'self-update', '--check']);

      expect(checkForUpdate).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should skip plugins when --skip-plugins is set', async () => {
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: false,
        currentVersion: '2.16.0',
        latestVersion: '2.16.0',
      });
      vi.mocked(getPlugins).mockReturnValue([]);

      await program.parseAsync(['node', 'test', 'self-update', '--check', '--skip-plugins']);

      expect(getPlugins).not.toHaveBeenCalled();
    });
  });

  // ============ Version Command ============
  describe('version', () => {
    it('should show current version and check for updates', async () => {
      vi.mocked(getCurrentVersion).mockReturnValue('2.16.0');
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: false,
        currentVersion: '2.16.0',
        latestVersion: '2.16.0',
      });
      vi.mocked(getPlugins).mockReturnValue([]);

      await program.parseAsync(['node', 'test', 'version']);

      expect(getCurrentVersion).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('znvault version 2.16.0');
    });

    it('should show update available', async () => {
      vi.mocked(getCurrentVersion).mockReturnValue('2.15.0');
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: true,
        currentVersion: '2.15.0',
        latestVersion: '2.16.0',
      });
      vi.mocked(getPlugins).mockReturnValue([]);

      await program.parseAsync(['node', 'test', 'version']);

      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
