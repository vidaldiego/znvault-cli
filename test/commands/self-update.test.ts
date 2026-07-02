// Path: znvault-cli/test/commands/self-update.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSelfUpdateCommands } from '../../src/commands/self-update.js';

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
  // getLatestVersion() shells out via execFileSync('npm', ['view', pkg, 'version']).
  execFileSync: vi.fn(() => Buffer.from('2.0.0\n')),
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
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

import { checkForUpdate, performUpdate, getCurrentVersion, clearUpdateCache } from '../../src/lib/cli-update.js';
import { getPlugins } from '../../src/lib/config.js';
import * as output from '../../src/lib/output.js';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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

  // ============ Plugin update mechanism (the self-update major-skip bug) ============
  describe('self-update plugin updates', () => {
    const PKG = '@zincapp/znvault-plugin-payara';

    // Wire up: CLI itself up to date; one plugin installed at 1.28.3 with 2.0.0
    // available (a MAJOR bump — the exact scenario that npm-update silently skipped).
    // installedVersion controls what getInstalledVersion() reads back AFTER the npm
    // call (the verification re-read), letting us exercise both applied + no-op cases.
    function wirePluginUpdate(installedVersionAfter: string) {
      vi.mocked(checkForUpdate).mockResolvedValue({
        updateAvailable: false, currentVersion: '4.13.0', latestVersion: '4.13.0',
      });
      vi.mocked(getPlugins).mockReturnValue([{ package: PKG, enabled: true } as never]);
      vi.mocked(existsSync).mockReturnValue(true);
      // getInstalledVersion() JSON.parses this. Detection reads 1.28.3; the post-run
      // verification re-read returns installedVersionAfter. We keep it simple: the
      // detection pass and verification pass both call readFileSync — return the
      // "after" value so the detection sees a stale current only via the impl's own
      // path is not needed; detection compares 1.28.3 vs 2.0.0 using the SAME reader,
      // so to still DETECT an update we seed the first read as 1.28.3 and later as after.
      let call = 0;
      vi.mocked(readFileSync).mockImplementation(() => {
        call += 1;
        // First read = detection (installed 1.28.3); subsequent = post-run verify.
        return JSON.stringify({ version: call === 1 ? '1.28.3' : installedVersionAfter });
      });
      // getLatestVersion() → execFileSync mock already returns '2.0.0'.
    }

    it('installs the @latest dist-tag (crosses a major), not bare `npm update`', async () => {
      wirePluginUpdate('2.0.0');
      try {
        await program.parseAsync(['node', 'test', 'self-update', '--yes']);
      } catch { /* performUpdate is mocked; ignore any exit */ }

      // The critical assertion: the plugin install must target `<pkg>@latest` via
      // `npm install`, NOT bare `npm update` (which cannot cross the ^1.x range).
      const npmInstallCall = vi.mocked(spawn).mock.calls.find(
        (c) => c[0] === 'npm' && Array.isArray(c[1]) && (c[1] as string[])[0] === 'install',
      );
      expect(npmInstallCall, 'expected a `npm install` spawn').toBeDefined();
      expect(npmInstallCall![1]).toContain(`${PKG}@latest`);
      // And it must NOT use bare `npm update`.
      const npmUpdateCall = vi.mocked(spawn).mock.calls.find(
        (c) => c[0] === 'npm' && Array.isArray(c[1]) && (c[1] as string[])[0] === 'update',
      );
      expect(npmUpdateCall, 'must not use bare `npm update`').toBeUndefined();
    });

    it('warns (does not falsely succeed) when the installed version did not change', async () => {
      // npm exits 0 but the on-disk version is STILL 1.28.3 (e.g. a silent no-op).
      wirePluginUpdate('1.28.3');
      const warnSpy = vi.mocked(output.spinner);
      try {
        await program.parseAsync(['node', 'test', 'self-update', '--yes']);
      } catch { /* ignore */ }

      // The success message must be gated on a real disk re-read: with the version
      // unchanged, the plugin spinner must warn, not succeed.
      const spinnerInstances = warnSpy.mock.results.map((r) => r.value);
      const anyWarned = spinnerInstances.some((s: { warn: ReturnType<typeof vi.fn> }) => s.warn.mock.calls.length > 0);
      const anyFalselySucceededPlugins = spinnerInstances.some(
        (s: { succeed: ReturnType<typeof vi.fn> }) =>
          s.succeed.mock.calls.some((c: unknown[]) => String(c[0] ?? '').includes('Plugins updated')),
      );
      expect(anyWarned, 'a spinner should warn about the unchanged plugin').toBe(true);
      expect(anyFalselySucceededPlugins, 'must NOT claim "Plugins updated" when unchanged').toBe(false);
    });
  });
});
