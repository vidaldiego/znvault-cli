// Path: znvault-cli/test/lib/banner-policy.test.ts

import { describe, it, expect } from 'vitest';
import { shouldSkipProfileIndicator } from '../../src/lib/banner-policy.js';

describe('shouldSkipProfileIndicator', () => {
  it('shows the banner for an ordinary command', () => {
    expect(shouldSkipProfileIndicator({ name: 'list', parent: 'secret', opts: {} })).toBe(false);
  });

  it('skips for shell-completion commands (stdout is evaluated by the shell)', () => {
    expect(shouldSkipProfileIndicator({ name: 'completion', parent: undefined, opts: {} })).toBe(true);
    expect(shouldSkipProfileIndicator({ name: 'bash', parent: 'completion', opts: {} })).toBe(true);
  });

  it('skips for `ssh forward --print-port` (JSON contract line on stdout)', () => {
    expect(shouldSkipProfileIndicator({ name: 'forward', parent: 'ssh', opts: { printPort: true } })).toBe(true);
    expect(shouldSkipProfileIndicator({ name: 'forward', parent: 'ssh', opts: {} })).toBe(false);
  });

  it('skips for `secret decrypt --raw` (value-only stdout for $(...) / files)', () => {
    expect(shouldSkipProfileIndicator({ name: 'decrypt', parent: 'secret', opts: { raw: true } })).toBe(true);
  });

  it('skips for `secret decrypt --field` (implies --raw)', () => {
    expect(shouldSkipProfileIndicator({ name: 'decrypt', parent: 'secret', opts: { field: 'password' } })).toBe(true);
  });

  it('keeps the banner for a plain `secret decrypt`', () => {
    expect(shouldSkipProfileIndicator({ name: 'decrypt', parent: 'secret', opts: {} })).toBe(false);
  });

  it('skips for --json on any command (stdout is a JSON document)', () => {
    expect(shouldSkipProfileIndicator({ name: 'list', parent: 'secret', opts: { json: true } })).toBe(true);
    expect(shouldSkipProfileIndicator({ name: 'status', parent: 'rootkey', opts: { json: true } })).toBe(true);
    expect(shouldSkipProfileIndicator({ name: 'health', parent: undefined, opts: { json: true } })).toBe(true);
  });

  it('keeps the banner when --json is absent or explicitly false', () => {
    expect(shouldSkipProfileIndicator({ name: 'list', parent: 'secret', opts: { json: false } })).toBe(false);
    expect(shouldSkipProfileIndicator({ name: 'list', parent: 'secret', opts: { json: undefined } })).toBe(false);
  });

  it('does not skip for --raw on an unrelated command with the same name', () => {
    expect(shouldSkipProfileIndicator({ name: 'decrypt', parent: 'kms', opts: { raw: true } })).toBe(false);
  });
});
