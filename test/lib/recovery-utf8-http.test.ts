import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import https from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture,sha} from '../helpers/recovery-fixture.js';
import {store} from '../../src/lib/config/store.js';
import {createRecoveryClient} from '../../src/lib/recovery/vault-key-provider.js';
import {verifyRecoverySet} from '../../src/vendor/archon-recovery-core/index.js';
let dir:string,server:https.Server,body:Buffer,split=0,requests=0;
let expected:Awaited<ReturnType<typeof fixture>>['expected'],manifest:Buffer;
beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'recovery-utf8-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',join(dir,'key'),'out',join(dir,'cert')].map(x=>x==='out'?'-out':x),{stdio:'ignore'});
 const cert=readFileSync(join(dir,'cert'));
 server=https.createServer({key:readFileSync(join(dir,'key')),cert},async(req,res)=>{
  requests++;expect(req.headers['x-api-key']).toBe('SYNTHETIC_UTF8_AUTH');
  res.setHeader('content-type','application/json');res.write(body.subarray(0,split));
  await new Promise(r=>setTimeout(r,5));res.end(body.subarray(split));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const original=https.request;
 vi.spyOn(https,'request').mockImplementation(((options:any,callback:any)=>original({...options,ca:cert},callback)) as any);

 const f=await fixture(dir);expected={...f.expected,serviceName:'Vault Málaga 日本 🗝',sourceNamespace:'custodia-ñ-日本'};
 manifest=Buffer.from(JSON.stringify({...JSON.parse(f.manifest.toString()),serviceName:expected.serviceName}));
 expected.metadata={kind:'manifest',sha256:sha(manifest),bytes:manifest.length};
});
beforeEach(()=>{ store.set('profiles',{utf8:{url:`https://localhost:${(server.address() as any).port}`,insecure:false,timeout:2000,apiKey:'SYNTHETIC_UTF8_AUTH'}});});
afterAll(async()=>{vi.restoreAllMocks();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});
it('preserves authenticated exact identity and manifest at every multibyte split',async()=>{
 body=Buffer.from(JSON.stringify({expected}));
 const splits=Array.from(body.keys()).filter(i=>i>0&&(body[i]&0xc0)===0x80);
 expect(splits.length).toBeGreaterThan(10);
 for(split of splits){
  const result=await createRecoveryClient('utf8').request<{expected:typeof expected}>({method:'GET',path:'/v1/backup-recovery/selections'});
  expect(result.expected).toEqual(expected);expect(verifyRecoverySet(result.expected,manifest).selection).toEqual(expected);
 }
 expect(requests).toBe(splits.length);
});
it.each(['malformed','truncated','limit'])('rejects %s response with sanitized bounded error',async kind=>{
 body=kind==='malformed'?Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc0,0xaf,0x22,0x7d]):kind==='truncated'?Buffer.from([0xe2,0x82]):Buffer.alloc(1024*1024+1,0x20);split=body.length-1;
 await expect(createRecoveryClient('utf8').request({method:'GET',path:'/v1/backup-recovery/selections'})).rejects.toThrow(/^recovery_/);
});
