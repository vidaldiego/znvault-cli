// Path: test/lib/cli-update.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isStdoutCapturedContext } from '../../src/lib/cli-update.js';

describe('cli-update — isStdoutCapturedContext', () => {
  let originalArgv: string[];
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalIsTTY = process.stdout.isTTY;
    // Force isTTY=true so the TTY check doesn't short-circuit the others.
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.argv = originalArgv;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    vi.restoreAllMocks();
  });

  it('detects `completion` subcommand', () => {
    process.argv = ['node', 'znvault', 'completion', 'zsh'];
    expect(isStdoutCapturedContext()).toBe(true);
  });

  it('detects `profile list --plain` (used by our zsh completion)', () => {
    process.argv = ['node', 'znvault', 'profile', 'list', '--plain'];
    expect(isStdoutCapturedContext()).toBe(true);
  });

  it('does NOT flag regular `profile list`', () => {
    process.argv = ['node', 'znvault', 'profile', 'list'];
    expect(isStdoutCapturedContext()).toBe(false);
  });

  it('does NOT flag unrelated commands when stdout is a TTY', () => {
    process.argv = ['node', 'znvault', 'secret', 'list'];
    expect(isStdoutCapturedContext()).toBe(false);
  });

  it('flags any command when stdout is not a TTY (piped/captured)', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    process.argv = ['node', 'znvault', 'secret', 'list'];
    expect(isStdoutCapturedContext()).toBe(true);
  });
});
