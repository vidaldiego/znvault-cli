import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, invalidS3Configs } from '../helpers/recovery-fixture.js';
it('rejects a local ciphertext changed during stable descriptor reading', async () => {
 const d = mkdtempSync(join(tmpdir(),'recovery-storage-'));
 try { const f = await fixture(d,{plain:Buffer.alloc(200000,65)}); const { localInputs } = await import('../../src/lib/recovery/storage.js');
 const input = localInputs(f.paths).open(f.set.components[0], new AbortController().signal); let count=0;
 await expect((async()=>{ for await (const _ of input) { if(++count===1) writeFileSync(f.paths.dump, Buffer.alloc(f.dump.length,1)); } })()).rejects.toThrow();
 } finally { rmSync(d,{recursive:true,force:true}); }
});
it('refuses incomplete or non-TLS explicit S3 configuration before transport', async () => {
 const { s3Inputs } = await import('../../src/lib/recovery/storage.js');
 const source = s3Inputs({ endpoint:'https://example.invalid', region:'test', bucket:'synthetic', accessKeyId:'test', secretAccessKey:'test' }); source.dispose();
 expect(() => s3Inputs({ endpoint:'http://127.0.0.1:1', region:'test', bucket:'synthetic', accessKeyId:'marker', secretAccessKey:'marker' })).toThrow();
 expect(() => s3Inputs({ endpoint:'https://example.invalid', region:'test', bucket:'synthetic', accessKeyId:'', secretAccessKey:'' })).toThrow();
});

it.each(invalidS3Configs)('rejects untrusted S3 config %s before opening transport',async(_name,config)=>{
 const {s3Inputs}=await import('../../src/lib/recovery/storage.js');expect(()=>s3Inputs(config)).toThrow();
});
