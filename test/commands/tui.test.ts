// Path: znvault-cli/test/commands/tui.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTuiCommands } from '../../src/commands/tui.js';

// Mock ink
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock React
vi.mock('react', () => ({
  default: {
    createElement: vi.fn(),
  },
}));

// Mock tui App
vi.mock('../../src/tui/App.js', () => ({
  App: vi.fn(),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

import { render } from 'ink';
import * as output from '../../src/lib/output.js';

describe('TUI Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerTuiCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });

    // Save original isTTY descriptor
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  });

  afterEach(() => {
    mockExit.mockRestore();
    // Restore original isTTY
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    } else {
      delete (process.stdout as Record<string, unknown>).isTTY;
    }
  });

  // ============ TUI Command ============
  describe('tui', () => {
    it('should launch TUI with default options', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'tui']);

      expect(render).toHaveBeenCalled();
    });

    it('should accept custom screen option', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'tui', '--screen', 'secrets']);

      expect(render).toHaveBeenCalled();
    });

    it('should accept custom refresh option', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'tui', '--refresh', '10000']);

      expect(render).toHaveBeenCalled();
    });

    it('should fail in non-TTY environment', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      await expect(program.parseAsync(['node', 'test', 'tui'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('TUI mode requires an interactive terminal');
    });

    it('should fail with invalid refresh interval', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await expect(program.parseAsync(['node', 'test', 'tui', '--refresh', '500'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Refresh interval must be at least 1000ms');
    });
  });

  // ============ Dashboard Command ============
  describe('dashboard', () => {
    it('should launch dashboard with default options', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'dashboard']);

      expect(render).toHaveBeenCalled();
    });

    it('should accept custom refresh option', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync(['node', 'test', 'dashboard', '--refresh', '10000']);

      expect(render).toHaveBeenCalled();
    });

    it('should fail in non-TTY environment', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      await expect(program.parseAsync(['node', 'test', 'dashboard'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Dashboard mode requires an interactive terminal');
    });

    it('should fail with invalid refresh interval', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await expect(program.parseAsync(['node', 'test', 'dashboard', '--refresh', '100'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Refresh interval must be at least 1000ms');
    });
  });
});
