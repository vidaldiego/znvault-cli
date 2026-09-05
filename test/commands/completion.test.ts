// Path: znvault-cli/test/commands/completion.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerCompletionCommands } from '../../src/commands/completion.js';

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  section: vi.fn(),
}));

import * as output from '../../src/lib/output.js';

describe('Completion Commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerCompletionCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ============ Completion Bash ============
  describe('completion bash', () => {
    it('should generate bash completion script', () => {
      program.parse(['node', 'test', 'completion', 'bash']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('_znvault_completions');
      expect(output).toContain('complete -F _znvault_completions znvault');
      expect(output).toContain('revoke protection');
      expect(output).toContain('decrypt) opts="--version --no-resolve --raw --field --output -o --json"');
    });
  });

  // ============ Completion Zsh ============
  describe('completion zsh', () => {
    it('should generate zsh completion script', () => {
      program.parse(['node', 'test', 'completion', 'zsh']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('_znvault()');
      expect(output).toContain('compdef _znvault znvault');
      expect(output).toContain("'--version[Decrypt a retained historical version]:number:'");
    });
  });

  // ============ Completion Default ============
  describe('completion (no subcommand)', () => {
    it('should show setup instructions', () => {
      program.parse(['node', 'test', 'completion']);

      expect(output.section).toHaveBeenCalledWith('Shell Completion Setup');
      expect(output.info).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
