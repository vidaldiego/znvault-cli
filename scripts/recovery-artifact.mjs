// Public immutable artifact identity, shared by the packer and acceptance harness.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export function tree(root) {
  const files = {};
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), stat = lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files[relative(root, file)] = digest(readFileSync(file));
      else throw Error('Nonregular artifact member');
    }
  }
  walk(root); return files;
}
export async function verifyIdentity(root, expected) {
  const pkg = readJson(join(root, 'package.json'));
  if (expected.packageSha256 && digest(readFileSync(join(root, 'package.json'))) !== expected.packageSha256) throw Error('CLI package metadata mismatch');
  if (pkg.version !== expected.version) throw Error('CLI version mismatch');
  let receipt;
  try { receipt = readJson(join(root, 'dist/recovery-build.json')); } catch { throw Error('Missing recovery build receipt'); }
  if (receipt.commit !== expected.commit) throw Error('CLI candidate commit mismatch');
  if (receipt.lockSha256 !== expected.lockSha256) throw Error('CLI lockfile mismatch');
  const provenance = (await import(pathToFileURL(join(root, 'dist/vendor/archon-recovery-core/provenance.js')).href)).recoveryCoreProvenance;
  if (provenance.sourceSha !== expected.sourceSha || provenance.exportSha256 !== expected.exportSha256) throw Error('Recovery source provenance mismatch');
  const actual = tree(join(root, 'dist')); delete actual['recovery-build.json'];
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) throw Error('Recovery compiled artifact digest mismatch');
  const original = readFileSync(join(root, 'dist/recovery-source/SOURCE-PROVENANCE.json'));
  if (digest(original) !== expected.exportSha256) throw Error('Recovery original provenance mismatch');
  for (const file of provenance.files) {
    if (digest(readFileSync(join(root, 'dist/recovery-source', file.path))) !== file.generatedSha256) throw Error('Recovery generated source mismatch');
    const upstream = JSON.parse(original).files.find(f => f.path === file.path);
    if (!upstream || upstream.sha256 !== file.sha256) throw Error('Recovery upstream source mismatch');
  }
  return { installedSourceCommit: receipt.commit, sourceSha: provenance.sourceSha, exportSha256: provenance.exportSha256 };
}
