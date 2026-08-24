// Path: znvault-cli/test/plugins/resolve-entry-point.test.ts

import { describe, it, expect } from 'vitest';
import { resolveCliEntryPoint } from '../../src/plugins/loader.js';

describe('resolveCliEntryPoint', () => {
  it('prefers a string ./cli export', () => {
    expect(resolveCliEntryPoint({ exports: { './cli': './dist/cli.js' }, main: 'x.js' }, 'p')).toBe('./dist/cli.js');
  });

  it('uses the import condition of a ./cli condition map, then default', () => {
    expect(resolveCliEntryPoint({ exports: { './cli': { import: './esm/cli.js', default: './cjs/cli.js' } } }, 'p')).toBe('./esm/cli.js');
    expect(resolveCliEntryPoint({ exports: { './cli': { default: './cjs/cli.js' } } }, 'p')).toBe('./cjs/cli.js');
  });

  it('rejects a ./cli condition map with no usable target (packaging error, not a crash)', () => {
    expect(() => resolveCliEntryPoint({ exports: { './cli': {} } }, 'my-plugin')).toThrow(/my-plugin.*'\.\/cli'/);
  });

  it('falls back to the root export import condition', () => {
    expect(resolveCliEntryPoint({ exports: { '.': { import: './index.mjs' } }, main: 'index.cjs' }, 'p')).toBe('./index.mjs');
  });

  it('ignores a string root export and uses main', () => {
    expect(resolveCliEntryPoint({ exports: { '.': './index.js' }, main: 'lib/main.js' }, 'p')).toBe('lib/main.js');
  });

  it('defaults to dist/index.js with no exports and no main', () => {
    expect(resolveCliEntryPoint({}, 'p')).toBe('dist/index.js');
  });
});
