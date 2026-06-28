// test/commands/mysql/mycnf.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { createMyCnf } from '../../../src/commands/mysql/mycnf.js';

describe('createMyCnf', () => {
  it('writes a 0600 [client] file and cleanup removes it', async () => {
    const { path, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    const stat = fs.statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
    const content = fs.readFileSync(path, 'utf8');
    expect(content).toContain('[client]');
    expect(content).toContain('user=u');
    expect(content).toContain('password=p');
    cleanup();
    expect(fs.existsSync(path)).toBe(false);
  });
});
