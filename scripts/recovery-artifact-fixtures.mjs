// Synthetic marker fixtures only. Companion bytes were produced by the original Archon writer.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { digest, readJson } from './recovery-artifact.mjs';
export async function prepareFixtures(root, originals, target) {
  const { encryptStream, wrapDekHex, computeKeyFingerprint } = await import(pathToFileURL(join(root, 'dist/vendor/archon-recovery-core/index.js')).href);
  const companion = readFileSync(join(originals, 'writer.companion')), reference = readJson(join(originals, 'writer-reference.json'));
  const material = readJson(join(originals, 'writer-material.json'));
  const cases = [];
  for (const epoch of ['before', 'after']) for (const compression of ['none', 'gzip', 'zstd']) {
    const dir = join(target, `${epoch}-${compression}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keys = [Buffer.alloc(32, epoch === 'before' ? 6 : 8), Buffer.alloc(32, 7)];
    const plain = Buffer.from(`SYNTHETIC_SQL_MARKER_${epoch}\nSELECT 1;\n`), dek = Buffer.alloc(32, 9);
    const compressed = compression === 'gzip' ? gzipSync(plain) : compression === 'zstd' ? zstdCompressSync(plain) : plain;
    const chunks = [];
    await encryptStream({ input: Readable.from([compressed]), output: new Writable({ write(b, _, cb) { chunks.push(Buffer.from(b)); cb(); } }), dek });
    const dump = Buffer.concat(chunks);
    const manifest = Buffer.from(JSON.stringify({ manifestVersion: 2, status: 'complete', backupId: 43, serviceName: 'Vault', storageKey: 'dump.enc', versionId: `${epoch}-v1`, wrappedDek: wrapDekHex(dek, keys[0]), wrappingKeyFingerprint: computeKeyFingerprint(keys[0]), compression, artifactSize: dump.length, artifactEtag: null, dumpChecksum: null, encryptedChecksum: digest(dump), recoveryCompanion: reference }));
    const selection = { format: 'znvault-backup-selection-v1', sourceNamespace: 'synthetic-independent-custody', installationUuid: reference.installationUuid, backupId: 43, serviceName: 'Vault', metadata: { kind: 'manifest', sha256: digest(manifest), bytes: manifest.length }, keyBindings: keys.map(k => ({ fingerprint: computeKeyFingerprint(k), key: { kind: 'archon-kek-fingerprint-v1', fingerprint: computeKeyFingerprint(k), algorithm: 'aes-256-gcm' } })) };
    for (const [name, bytes] of Object.entries({ 'input.arcn': dump, 'companion.enc': companion, 'manifest.json': manifest, 'selection.json': JSON.stringify(selection), 'expected.sql': plain, 'key-0': keys[0], 'key-1': keys[1] })) writeFileSync(join(dir, name), bytes, { mode: 0o600 });
    cases.push({ name: `${epoch}-${compression}`, dir, plain, material, keys, ciphertext: digest(dump) });
  }
  return cases;
}

export function copyPreparedFixtures(prepared, target) {
  const names=readJson(join(prepared,'cases.json'));
  if(!Array.isArray(names)||names.length!==6||names.some(n=>!/^(before|after)-(none|gzip|zstd)$/.test(n)))throw Error('Synthetic prepared fixture set required');
  mkdirSync(target,{recursive:true,mode:0o700});
  return names.map(name=>{const dir=join(target,name);cpSync(join(prepared,name),dir,{recursive:true});return {name,dir,plain:readFileSync(join(dir,'expected.sql')),material:readJson(join(prepared,'writer-material.json')),keys:[readFileSync(join(dir,'key-0')),readFileSync(join(dir,'key-1'))],ciphertext:digest(readFileSync(join(dir,'input.arcn')))};});
}
