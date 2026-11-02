import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
it('rejects an actual package missing its recovery snapshot before installing dependencies', () => {
  const work = mkdtempSync(join(tmpdir(), 'recovery-bad-package-'));
  try {
    const pack = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8' }))[0];
    execFileSync('tar', ['-xzf', join(work, pack.filename), '-C', work]);
    rmSync(join(work, 'package/dist/vendor/archon-recovery-core'), { recursive: true, force: true });
    execFileSync('tar', ['-czf', join(work, 'missing.tgz'), '-C', work, 'package']);
    const result = spawnSync(process.execPath, [join(root, 'scripts/verify-package.mjs'), join(work, 'missing.tgz'), '5.8.1'], { encoding: 'utf8', timeout: 120000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('recovery snapshot');
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 180000);

it('platform acceptance requires an exact artifact and never falls back when absent', () => {
  const result=spawnSync(process.execPath,[join(root,'scripts/verify-recovery-package.mjs')],{encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stderr).toContain('Require absolute tarball');
});
