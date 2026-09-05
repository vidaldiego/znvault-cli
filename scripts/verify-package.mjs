import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [tarball, expectedVersion] = process.argv.slice(2);
if (!tarball || !expectedVersion) throw new Error('Usage: verify-package.mjs <tgz> <version>');
const scratch = mkdtempSync(join(tmpdir(), 'znvault-package-check-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('ZNVAULT_') && key !== 'DATABASE_URL'));
Object.assign(env, { CI: '1', ZNVAULT_NO_UPDATE_CHECK: '1', ZNVAULT_NO_PLUGINS: '1',
  ZNVAULT_CONFIG_DIR: join(scratch, 'config') });
try {
  execFileSync('npm', ['install', '--prefix', scratch, '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarball)], { env, stdio: 'pipe' });
  const root = join(scratch, 'node_modules/@zincapp/znvault-cli');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== expectedVersion) throw new Error('Installed package version mismatch');
  for (const file of ['dist/commands/lmk-ceremony.js', 'dist/lib/db/preflight.js',
    'dist/lib/db/key-lifecycle.js', 'dist/lib/ceremony/gates.js']) {
    if (existsSync(join(root, file))) throw new Error(`Retired compiled artifact leaked: ${file}`);
  }
  const run = (...args) => execFileSync(process.execPath, [join(root, 'dist/index.js'), '--no-plugins', ...args], { env, cwd: scratch, encoding: 'utf8' });
  if (run('--version').trim() !== expectedVersion) throw new Error('CLI version mismatch');
  const escrow = run('superadmin', 'lmk', 'escrow', '--help');
  if (!/^  verify/m.test(escrow) || !/^  restore/m.test(escrow) || /^  snapshot/m.test(escrow)) throw new Error('Legacy escrow compatibility failure');
  const lmk = run('superadmin', 'lmk', '--help');
  if (/^  ceremony/m.test(lmk) || !/^  preflight/m.test(lmk)) throw new Error('Trust boundary failure');
  const secrets = run('secret', '--help');
  for (const command of ['grants', 'grant', 'revoke', 'recover', 'recover-grant', 'protection']) {
    if (!new RegExp(`^  ${command} `, 'm').test(secrets)) throw new Error(`User-Sealed command missing: ${command}`);
  }
  if (!run('dynasec', 'permit', '--help').includes('lookup')) throw new Error('DR permit lookup missing');
  if (!run('emergency', '--help').includes('Usage:')) throw new Error('Emergency command missing');
  console.log(`Exact package verified: ${expectedVersion}; Trust, User-Sealed and DR command surfaces present`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
