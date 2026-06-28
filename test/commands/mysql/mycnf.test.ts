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
});
