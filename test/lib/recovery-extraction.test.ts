import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixture } from '../helpers/recovery-fixture.js';
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'recovery-extract-')); dirs.push(d); return d; };
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
async function setup(options = {}) {
 const d = temp(), f = await fixture(d, options);
 const { recoverSet } = await import('../../src/lib/recovery/recover.js');
 const { localInputs } = await import('../../src/lib/recovery/storage.js');
 return { ...f, d, output: join(d, 'output'), recoverSet, inputs: localInputs(f.paths), provider: async (key: {fingerprint:string}) => Buffer.from(f.keys[f.set.components.findIndex(c => c.key.fingerprint === key.fingerprint)]) };
}
it('extractsDumpAndCompanionTogether', async () => {
 const f = await setup({ companion: true, managedKeys:true });
 expect(f.set.components.map(c=>c.key.kind==='vault-backup-key-v1'?c.key.keyVersion:0)).toEqual([2,1]);
 const result = await f.recoverSet(f.set, f.inputs, f.provider, { mode: 'extract', output: f.output });
 expect(result.authenticated).toBe(true); expect(readFileSync(join(f.output, 'content/database.sql'))).toEqual(f.plain);
 expect(readFileSync(join(f.output, 'content/companion/vault/bsk'))).toEqual(Buffer.alloc(32, 0x55));
 expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SQL_MARKER'); expect(JSON.stringify(result)).not.toContain('vault/bsk');
});
it('lateCompanionFailurePublishesNothing', async () => {
 const f = await setup({ companion: true }); writeFileSync(f.paths.companion, f.companion.subarray(0,-1));
 await expect(f.recoverSet(f.set, f.inputs, f.provider, { mode:'extract', output:f.output })).rejects.toThrow();
 expect(existsSync(join(f.output,'content'))).toBe(false);
});
it('wholeValidSetSubstitutionRejected', async () => {
 const f = await setup(); const original = structuredClone(f.set);
 const inputs = { async *open() { f.set.selection.backupId++; yield f.dump; } };
 await expect(f.recoverSet(f.set, inputs, f.provider, { mode:'extract', output:f.output })).rejects.toThrow();
 expect(existsSync(join(f.output,'content'))).toBe(false); expect(original.selection.backupId).toBe(43);
});
it('twoWritersCannotReplaceOutput', async () => {
 const f = await setup(); const results = await Promise.allSettled([1,2].map(() => f.recoverSet(f.set, f.inputs, f.provider, { mode:'extract', output:f.output })));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect(readFileSync(join(f.output,'content/database.sql'))).toEqual(f.plain);
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output})).rejects.toThrow(); expect(readFileSync(join(f.output,'content/database.sql'))).toEqual(f.plain);
});
it('cancelAndDiskFullLeaveNoSuccessfulReceipt', async () => {
 const f = await setup(); const abort = new AbortController(); abort.abort();
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output,signal:abort.signal})).rejects.toThrow();
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output,minFreeBytes:Number.MAX_SAFE_INTEGER})).rejects.toThrow();
 expect(existsSync(join(f.output,'content'))).toBe(false);
});
it.each(['none','gzip','zstd'] as const)('verifies complete %s stream without leaving plaintext', async compression => {
 const f = await setup({ compression }); const before = readdirSync(f.d).sort();
 const r = await f.recoverSet(f.set,f.inputs,f.provider,{mode:'verify',temporaryParent:f.d});
 expect(r.authenticated).toBe(true); expect(readdirSync(f.d).sort()).toEqual(before);
});
it.each(['bytes','ratio','codec'] as const)('rejects expansion %s and publishes no set', async failure => {
 const f = await setup({ compression:'gzip', plain:Buffer.alloc(100000, 65), badCodec:failure==='codec' });
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output,maxExpandedBytes:failure==='bytes'?100:1000000,maxExpansionRatio:failure==='ratio'?2:10000})).rejects.toThrow();
 expect(existsSync(join(f.output,'content'))).toBe(false);
});
it.each(['gzip','zstd'] as const)('rejects %s codec trailing bytes after authenticated encryption', async compression => {
 const f = await setup({compression});
 const { encryptStream, verifyRecoverySet } = await import('../../src/vendor/archon-recovery-core/index.js');
 const { Readable, Writable } = await import('node:stream');
 const { gzipSync,zstdCompressSync } = await import('node:zlib');
 const { sha } = await import('../helpers/recovery-fixture.js');
 const packed=compression==='gzip'?gzipSync(f.plain):zstdCompressSync(f.plain);const chunks:Buffer[]=[];
 await encryptStream({input:Readable.from([Buffer.concat([packed,Buffer.alloc(8)])]),output:new Writable({write(b,_e,cb){chunks.push(Buffer.from(b));cb();}}),dek:Buffer.alloc(32,9)});
 const dump=Buffer.concat(chunks);writeFileSync(f.paths.dump,dump);
 const metadata=JSON.parse(f.manifest.toString());metadata.artifactSize=dump.length;metadata.encryptedChecksum=sha(dump);
 const manifest=Buffer.from(JSON.stringify(metadata));const expected=structuredClone(f.expected);expected.metadata={kind:'manifest',sha256:sha(manifest),bytes:manifest.length};
 const set=verifyRecoverySet(expected,manifest);
 await expect(f.recoverSet(set,f.inputs,f.provider,{mode:'extract',output:f.output})).rejects.toThrow();expect(existsSync(join(f.output,'content'))).toBe(false);
});
it('bounds the zstd decoder window before a large native allocation',async()=>{
 const { zstdCompressSync,constants } = await import('node:zlib');
 const packed=zstdCompressSync(Buffer.alloc(16*1024*1024,65),{params:{[constants.ZSTD_c_windowLog]:24,[constants.ZSTD_c_contentSizeFlag]:0}});
 const f=await setup({compression:'zstd',packed});
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output,maxExpansionRatio:1000000})).rejects.toThrow();expect(existsSync(join(f.output,'content'))).toBe(false);
});
it.each(['traversal','duplicate','missing'] as const)('rejects authenticated companion member %s without a partial dump',async fault=>{
 const f=await setup({companion:true});const {createCipheriv}=await import('node:crypto');const {wrapDekHex,verifyRecoverySet}=await import('../../src/vendor/archon-recovery-core/index.js');const {sha,fixtures}=await import('../helpers/recovery-fixture.js');
 const material=JSON.parse(readFileSync(join(fixtures,'writer-material.json'),'utf8'));
 if(fault==='traversal')material.files[0].name='../outside';if(fault==='duplicate')material.files[1]=material.files[0];if(fault==='missing')material.files.pop();
 const metadata=JSON.parse(f.manifest.toString()),ref=metadata.recoveryCompanion,iv=Buffer.alloc(12,31),dek=Buffer.alloc(32,19),cipher=createCipheriv('aes-256-gcm',dek,iv);
 const aad={backupId:ref.backupId,format:'archon-application-recovery-aad-v1',installationUuid:ref.installationUuid,runId:ref.runId,sourceFingerprint:ref.sourceFingerprint};cipher.setAAD(Buffer.from(JSON.stringify(aad)));
 const wire=Buffer.concat([Buffer.from('ARCM1'),iv,cipher.update(JSON.stringify(material)),cipher.final(),cipher.getAuthTag()]);ref.wrappedDek=wrapDekHex(dek,f.keys[1]);ref.sha256=sha(wire);ref.bytes=wire.length;writeFileSync(f.paths.companion,wire);
 const manifest=Buffer.from(JSON.stringify(metadata)),expected=structuredClone(f.expected);expected.metadata={kind:'manifest',sha256:sha(manifest),bytes:manifest.length};
 await expect(f.recoverSet(verifyRecoverySet(expected,manifest),f.inputs,f.provider,{mode:'extract',output:f.output})).rejects.toThrow();expect(existsSync(join(f.output,'content'))).toBe(false);expect(existsSync(join(f.d,'outside'))).toBe(false);
});
it('preserves caller-owned key buffers on late authentication failure',async()=>{
 const f=await setup({companion:true});writeFileSync(f.paths.companion,Buffer.alloc(33));
 await expect(f.recoverSet(f.set,f.inputs,async key=>f.keys[key.fingerprint===f.set.components[0].key.fingerprint?0:1],{mode:'extract',output:f.output})).rejects.toThrow();expect(f.keys[0]).toEqual(Buffer.alloc(32,6));expect(f.keys[1]).toEqual(Buffer.alloc(32,7));
});
it.skipIf(spawnSync('zstd',['--version']).error !== undefined)('accepts a 16 MiB stream produced by Archons existing zstd -c - writer defaults with the 8 MiB decoder window',async()=>{
 const plain=Buffer.alloc(16*1024*1024,65);
 const produced=spawnSync('zstd',['-c','-'],{input:plain,maxBuffer:32*1024*1024});
 expect(produced.status).toBe(0);const f=await setup({compression:'zstd',plain,packed:produced.stdout});
 await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'extract',output:f.output,maxExpansionRatio:1000000})).resolves.toMatchObject({authenticated:true});expect(readFileSync(join(f.output,'content/database.sql')).equals(plain)).toBe(true);
});
it('verify cannot report success when private plaintext cleanup is obstructed',async()=>{
 const f=await setup();const {Workspace}=await import('../../src/lib/recovery/workspace.js');const original=Workspace.prototype.cleanup;
 const spy=vi.spyOn(Workspace.prototype,'cleanup').mockImplementation(async function(this:InstanceType<typeof Workspace>,preserveRoot){writeFileSync(join(this.root,'operator-added'),'do-not-delete');return original.call(this,preserveRoot);});
 try{await expect(f.recoverSet(f.set,f.inputs,f.provider,{mode:'verify',temporaryParent:f.d})).rejects.toThrow();const residue=readdirSync(f.d).find(n=>n.startsWith('znvault-recovery-'))!;expect(readFileSync(join(f.d,residue,'operator-added'),'utf8')).toBe('do-not-delete');}finally{spy.mockRestore();}
});
it('recovers frozen ARCN bytes produced by the original pre-extraction Archon writer',async()=>{
 const f=await setup();const {fixtures,sha}=await import('../helpers/recovery-fixture.js');const {verifyRecoverySet}=await import('../../src/vendor/archon-recovery-core/index.js');
 const original=readFileSync(join(fixtures,'writer.arcn'));writeFileSync(f.paths.dump,original);
 const metadata=JSON.parse(f.manifest.toString());metadata.artifactSize=original.length;metadata.encryptedChecksum=sha(original);
 const manifest=Buffer.from(JSON.stringify(metadata)),expected=structuredClone(f.expected);expected.metadata={kind:'manifest',sha256:sha(manifest),bytes:manifest.length};
 await expect(f.recoverSet(verifyRecoverySet(expected,manifest),f.inputs,f.provider,{mode:'extract',output:f.output})).resolves.toMatchObject({authenticated:true});
 const restored=readFileSync(join(f.output,'content/database.sql'));expect(restored.length).toBe(196627);expect(restored.every((byte,i)=>byte===i%251)).toBe(true);
});

it.each(['success','error','cancel'])('normal system tmp verify cleans owned reservation on %s', async outcome => {
 const f = await setup({companion:true});
 const before = readdirSync('/tmp').filter(n=>n.startsWith('znvault-recovery-')).sort();
 const controller=new AbortController();
 const inputs=outcome==='success'?f.inputs:{async *open(){if(outcome==='cancel')controller.abort();else throw Error('synthetic_failure');yield Buffer.alloc(0);}};
 vi.stubEnv('TMPDIR','/tmp');vi.stubEnv('TMP','/tmp');vi.stubEnv('TEMP','/tmp');
 try {
  const operation=f.recoverSet(f.set,inputs,f.provider,{mode:'verify',signal:controller.signal});
  if(outcome==='success')expect((await operation).authenticated).toBe(true);else await expect(operation).rejects.toThrow();
  expect(readdirSync('/tmp').filter(n=>n.startsWith('znvault-recovery-')).sort()).toEqual(before);
 } finally {vi.unstubAllEnvs();}
});
