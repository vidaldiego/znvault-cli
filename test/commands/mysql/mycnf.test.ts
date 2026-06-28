// test/commands/mysql/mycnf.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { createMyCnf } from '../../../src/commands/mysql/mycnf.js';

describe('createMyCnf', () => {
  it('writes a 0600 [client] file and cleanup removes it', async () => {
    const { path: cnfPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    const dirStat = fs.statSync(nodePath.dirname(cnfPath));
    expect(dirStat.mode & 0o777).toBe(0o700);
    const stat = fs.statSync(cnfPath);
    expect(stat.mode & 0o777).toBe(0o600);
    const content = fs.readFileSync(cnfPath, 'utf8');
    expect(content).toContain('[client]');
    expect(content).toContain('user=u');
    expect(content).toContain('password=p');
    cleanup();
    expect(fs.existsSync(cnfPath)).toBe(false);
  });

  // ── I-3: cleanup() must be idempotent / best-effort ──────────────────────
  // With spawn-then-unlink (F1), the cnf may already be gone by the time
  // cleanup() runs (runMysql unlinks it right after spawn). cleanup() must not
  // throw when the file — or even the directory — is already removed.
  it('cleanup() is safe to call when the file is already unlinked', async () => {
    const { path: cnfPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    // Simulate the file already being removed (as runMysql does after spawn).
    fs.unlinkSync(cnfPath);
    expect(fs.existsSync(cnfPath)).toBe(false);
    // cleanup must not throw on the missing file; it should still rmdir.
    expect(() => { cleanup(); }).not.toThrow();
    expect(fs.existsSync(nodePath.dirname(cnfPath))).toBe(false);
  });

  it('cleanup() is idempotent — calling it twice does not throw', async () => {
    const { path: cnfPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    expect(fs.existsSync(cnfPath)).toBe(true);
    cleanup();
    expect(() => { cleanup(); }).not.toThrow();
  });
});
