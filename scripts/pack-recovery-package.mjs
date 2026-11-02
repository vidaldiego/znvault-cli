// Preparation may use npm/cache/network. The resulting tarball still requires dependencies.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { digest, tree, readJson } from './recovery-artifact.mjs';
const [output, expectedCommit] = process.argv.slice(2), root = resolve(import.meta.dirname, '..');
if (!output || !isAbsolute(output) || !/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw Error('Require absolute new output directory and exact CLI commit');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (run('git', ['rev-parse', 'HEAD']).trim() !== expectedCommit || run('git', ['status', '--porcelain']).trim()) throw Error('CLI candidate must be exact and clean');
run('npm', ['run', 'recovery-core:check']); run('npm', ['run', 'build:prod']);
cpSync(join(root, 'src/vendor/archon-recovery-core'), join(root, 'dist/recovery-source'), { recursive: true });
writeFileSync(join(root, 'dist/recovery-build.json'), JSON.stringify({ format: 'znvault-recovery-build-v1', commit: expectedCommit, lockSha256: digest(readFileSync(join(root, 'package-lock.json'))), files: tree(join(root, 'dist')) }));
mkdirSync(output, { mode: 0o700 });
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output]))[0];
const provenance = readJson(join(root, 'src/vendor/archon-recovery-core/SOURCE-PROVENANCE.json'));
const receipt = { artifact: join(output, packed.filename), sha256: digest(readFileSync(join(output, packed.filename))), commit: expectedCommit, version: readJson(join(root, 'package.json')).version, lockSha256: digest(readFileSync(join(root, 'package-lock.json'))), sourceSha: provenance.sourceSha, exportSha256: digest(readFileSync(join(root, 'src/vendor/archon-recovery-core/SOURCE-PROVENANCE.json'))) };
writeFileSync(join(output, 'candidate.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
