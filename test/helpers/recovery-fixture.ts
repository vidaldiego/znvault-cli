import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { computeKeyFingerprint, encryptStream, verifyRecoverySet, wrapDekHex, type ExpectedSelection } from '../../src/vendor/archon-recovery-core/index.js';
export const fixtures = join(import.meta.dirname, '../fixtures/recovery');
export const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function fixture(directory: string, options: { companion?: boolean; compression?: 'none'|'gzip'|'zstd'; plain?: Buffer; badCodec?: boolean; packed?:Buffer; versionId?:string|null; managedKeys?:boolean } = {}) {
  const keys = [Buffer.alloc(32, 6), Buffer.alloc(32, 7)];
  const plain = options.plain ?? Buffer.from('SYNTHETIC_SQL_MARKER\nSELECT 1;\n');
  const compression = options.compression ?? 'none';
  const packed = options.packed ?? (options.badCodec ? Buffer.from('invalid compressed data') : compression === 'gzip' ? gzipSync(plain) : compression === 'zstd' ? zstdCompressSync(plain) : plain);
  const chunks: Buffer[] = [];
  await encryptStream({ input: Readable.from([packed]), output: new Writable({ write(b, _e, cb) { chunks.push(Buffer.from(b)); cb(); } }), dek: Buffer.alloc(32, 9) });
  const dump = Buffer.concat(chunks);
  const companion = readFileSync(join(fixtures, 'writer.companion'));
  const reference = JSON.parse(readFileSync(join(fixtures, 'writer-reference.json'), 'utf8'));
  const manifest = Buffer.from(JSON.stringify({ manifestVersion: 2, status: 'complete', backupId: 43, serviceName: 'Vault', storageKey: 'dump.enc', versionId: options.versionId === undefined ? 'dump-version-2' : options.versionId, wrappedDek: wrapDekHex(Buffer.alloc(32, 9), keys[0]), wrappingKeyFingerprint: computeKeyFingerprint(keys[0]), compression, artifactSize: dump.length, artifactEtag: null, dumpChecksum: null, encryptedChecksum: sha(dump), ...(options.companion ? { recoveryCompanion: { ...reference, versionId: 'companion-version-1' } } : {}) }));
  const expected: ExpectedSelection = { format: 'znvault-backup-selection-v1', sourceNamespace: 'test-independent-custody', installationUuid: reference.installationUuid, backupId: 43, serviceName: 'Vault', metadata: { kind: 'manifest', sha256: sha(manifest), bytes: manifest.length }, keyBindings: keys.slice(0, options.companion ? 2 : 1).map((key,i) => ({ fingerprint: computeKeyFingerprint(key), key: options.managedKeys ? { kind:'vault-backup-key-v1',familyId:'11111111-1111-4111-8111-111111111111',keyVersion:i===0?2:1,materialId:`22222222-2222-4222-8222-22222222222${i}`,sourceInstallationId:'33333333-3333-4333-8333-333333333333',sourceSecretId:`44444444-4444-4444-8444-44444444444${i}`,sourceDataVersion:i===0?7:3,fingerprint:computeKeyFingerprint(key),algorithm:'aes-256-gcm' } : { kind: 'archon-kek-fingerprint-v1', fingerprint: computeKeyFingerprint(key), algorithm: 'aes-256-gcm' } })) };
  const paths = { dump: join(directory, 'input.arcn'), companion: join(directory, 'companion.enc') };
  writeFileSync(paths.dump, dump); writeFileSync(paths.companion, companion);
  writeFileSync(join(directory, 'manifest.json'), manifest); writeFileSync(join(directory, 'selection.json'), JSON.stringify(expected));
  const keyFiles = keys.slice(0, options.companion ? 2 : 1).map((key, i) => { const path = join(directory, `key-${i}`); writeFileSync(path, key, { mode: 0o600 }); return path; });
  return { set: verifyRecoverySet(expected, manifest), expected, manifest, keys, keyFiles, paths, dump, plain, companion };
}
// Public config syntax cases; no real credentials/endpoints are used.
const s3Base={endpoint:'https://example.invalid',region:'eu-west-1',bucket:'synthetic-bucket',accessKeyId:'synthetic-access',secretAccessKey:'S3_SECRET_MARKER'};
export const invalidS3Configs:Array<[string,unknown]>=[['root null',null],['root array',[]],['root string','invalid']];
for(const field of ['endpoint','region','bucket','accessKeyId','secretAccessKey']){
 const missing:Record<string,unknown>={...s3Base};delete missing[field];invalidS3Configs.push([`${field} missing`,missing]);
 for(const value of [null,123,true,[],{}])invalidS3Configs.push([`${field} ${value===null?'null':Array.isArray(value)?'array':typeof value}`,{...s3Base,[field]:value}]);
 invalidS3Configs.push([`${field} empty`,{...s3Base,[field]:''}]);
}
for(const [field,values] of Object.entries({
 endpoint:['http://example.invalid','https://user:password@example.invalid','https://example.invalid/path','https://example.invalid/?query=1','https://example.invalid/#fragment','https://'+ 'a'.repeat(2049)],
 region:['bad region','a'.repeat(81)],bucket:['BAD-BUCKET','bad/bucket','a'.repeat(64)],
 accessKeyId:['  ','bad\nheader','a'.repeat(257)],secretAccessKey:['  ','bad\nheader','a'.repeat(4097)],
 sessionToken:[null,123,true,[],{},'','  ','bad\nheader','a'.repeat(16385)],
 tlsCaPem:[null,123,true,[],{},'','  ','not a certificate','-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----','a'.repeat(16385)],
 deadlineMs:[null,0,99,120001,100.5,'1000',false,[],{}],
}))for(const [i,value]of values.entries())invalidS3Configs.push([`${field} invalid ${i}`,{...s3Base,[field]:value}]);
invalidS3Configs.push(['unknown field',{...s3Base,profile:'must-never-resolve'}]);
