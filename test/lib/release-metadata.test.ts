import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const checker = resolve('scripts/check-release.mjs');
function check(versionFile: string, tag: string, lockVersion = '5.0.0'): number | null {
  const root = mkdtempSync(join(tmpdir(), 'release-metadata-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '5.0.0' }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: lockVersion, packages: { '': { version: lockVersion } } }));
    writeFileSync(join(root, 'VERSION'), versionFile);
    return spawnSync(process.execPath, [checker, tag], {
      cwd: root, env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8',
    }).status;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('release metadata gate', () => {
  it('accepts a consistent tagged version', () => { expect(check('5.0.0\n', 'v5.0.0')).toBe(0); });
  it('rejects a stale VERSION file', () => { expect(check('2.1.0', 'v5.0.0')).not.toBe(0); });
  it('rejects a mismatched release tag', () => { expect(check('5.0.0', 'v4.25.0')).not.toBe(0); });
  it('rejects a stale lockfile', () => { expect(check('5.0.0', 'v5.0.0', '4.25.0')).not.toBe(0); });
});
