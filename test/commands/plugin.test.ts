// Path: znvault-cli/test/commands/plugin.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPluginCommands } from '../../src/commands/plugin/index.js';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((s: string) => s),
    cyan: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    blue: vi.fn((s: string) => s),
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
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock config
vi.mock('../../src/lib/config.js', () => ({
  getPlugins: vi.fn(),
  addPlugin: vi.fn(),
  removePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  getConfigPath: vi.fn(() => '/home/user/.config/znvault/config.json'),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getPlugins, addPlugin, removePlugin, setPluginEnabled } from '../../src/lib/config.js';
import * as output from '../../src/lib/output.js';

describe('Plugin Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerPluginCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // ============ Plugin List ============
  describe('plugin list', () => {
    it('should list installed plugins', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: true },
      ]);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      program.parse(['node', 'test', 'plugin', 'list']);

      expect(getPlugins).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should show message when no plugins installed', () => {
      vi.mocked(getPlugins).mockReturnValue([]);

      program.parse(['node', 'test', 'plugin', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: true },
      ]);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      program.parse(['node', 'test', 'plugin', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  // ============ Plugin Enable ============
  describe('plugin enable', () => {
    it('should enable a disabled plugin', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: false },
      ]);

      program.parse(['node', 'test', 'plugin', 'enable', 'payara']);

      expect(setPluginEnabled).toHaveBeenCalledWith('@zincapp/znvault-plugin-payara', true);
      expect(output.success).toHaveBeenCalled();
    });

    it('should show message when plugin already enabled', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: true },
      ]);

      program.parse(['node', 'test', 'plugin', 'enable', 'payara']);

      expect(setPluginEnabled).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should fail when plugin not found', () => {
      vi.mocked(getPlugins).mockReturnValue([]);

      expect(() => program.parse(['node', 'test', 'plugin', 'enable', 'unknown'])).toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalled();
    });
  });

  // ============ Plugin Disable ============
  describe('plugin disable', () => {
    it('should disable an enabled plugin', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: true },
      ]);

      program.parse(['node', 'test', 'plugin', 'disable', 'payara']);

      expect(setPluginEnabled).toHaveBeenCalledWith('@zincapp/znvault-plugin-payara', false);
      expect(output.success).toHaveBeenCalled();
    });

    it('should show message when plugin already disabled', () => {
      vi.mocked(getPlugins).mockReturnValue([
        { package: '@zincapp/znvault-plugin-payara', enabled: false },
      ]);

      program.parse(['node', 'test', 'plugin', 'disable', 'payara']);

      expect(setPluginEnabled).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should fail when plugin not found', () => {
      vi.mocked(getPlugins).mockReturnValue([]);

      expect(() => program.parse(['node', 'test', 'plugin', 'disable', 'unknown'])).toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalled();
    });
  });
});
