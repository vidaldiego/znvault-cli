// test/commands/mysql/alias.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('mysql alias store', () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(async () => {
    prev = process.env.ZNVAULT_CONFIG_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-alias-'));
    process.env.ZNVAULT_CONFIG_DIR = dir;
    const { _resetStoreInstance } = await import('../../../src/lib/config/store.js');
    _resetStoreInstance();
  });

  afterEach(async () => {
    const { _resetStoreInstance } = await import('../../../src/lib/config/store.js');
    _resetStoreInstance();
    if (prev === undefined) {
      delete process.env.ZNVAULT_CONFIG_DIR;
    } else {
      process.env.ZNVAULT_CONFIG_DIR = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds, gets, lists, removes', async () => {
    const a = await import('../../../src/commands/mysql/alias.js');
    a.addAlias('staging-rw', 'staging-mysql', 'app-rw');
    expect(a.getAlias('staging-rw')).toEqual({ connection: 'staging-mysql', role: 'app-rw' });
    expect(a.listAliases().map((x) => x.name)).toContain('staging-rw');
    a.removeAlias('staging-rw');
    expect(a.getAlias('staging-rw')).toBeUndefined();
  });
});
