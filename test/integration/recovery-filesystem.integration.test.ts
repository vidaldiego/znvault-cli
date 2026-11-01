import { afterEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:https';
import { fixture } from '../helpers/recovery-fixture.js';
import { recoverSet } from '../../src/lib/recovery/recover.js';
import { localInputs, s3Inputs } from '../../src/lib/recovery/storage.js';
const root=resolve(import.meta.dirname,'../..'),dirs:string[]=[];
const temp=()=>{const d=mkdtempSync(join(tmpdir(),'recovery-real-'));dirs.push(d);return d;};
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
const args=(d:string,keyFiles:string[])=>['recovery','extract','--input',join(d,'input.arcn'),'--manifest',join(d,'manifest.json'),'--expect',join(d,'selection.json'),...keyFiles.flatMap(p=>['--key-file',p]),'--output',join(d,'output')];
async function runChild(argv:string[]){const child=spawn(process.execPath,argv,{cwd:root,env:{...process.env,ZNVAULT_CONFIG_DIR:join(temp(),'config')},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=String(b));child.stderr.on('data',b=>err+=String(b));const [code]=await once(child,'exit');return{code,out,err};}
it('real competing CLI processes publish exactly one complete set and preserve prior bytes',async()=>{
 const d=temp(),f=await fixture(d,{plain:Buffer.alloc(4*1024*1024,65)});
 const writers=await Promise.all([1,2].map(()=>runChild([join(root,'dist/index.js'),...args(d,f.keyFiles)])));
 expect(writers.filter(w=>w.code===0)).toHaveLength(1);expect(readFileSync(join(d,'output/content/database.sql')).equals(f.plain)).toBe(true);
 const again=await runChild([join(root,'dist/index.js'),...args(d,f.keyFiles)]);expect(again.code).not.toBe(0);expect(readFileSync(join(d,'output/content/database.sql')).equals(f.plain)).toBe(true);
 expect(statSync(join(d,'output')).mode&0o777).toBe(0o700);expect(statSync(join(d,'output/content/database.sql')).mode&0o777).toBe(0o600);
});
it('SIGKILL after provisional SQL leaves no published content or successful receipt and cannot adopt residue',async()=>{
 const d=temp(),f=await fixture(d,{companion:true});
 const child=spawn(process.execPath,[join(root,'test/helpers/recovery-worker.mjs'),root,'pause-companion',d],{stdio:['ignore','pipe','pipe','ipc']});
 await once(child,'message');const stage=readdirSync(join(d,'output')).find(n=>n.startsWith('.staging-'))!;
 expect(existsSync(join(d,'output',stage,'set/database.sql'))).toBe(true);child.kill('SIGKILL');await once(child,'exit');
 expect(existsSync(join(d,'output/content'))).toBe(false);expect(existsSync(join(d,'output',stage,'set/recovery-receipt.json'))).toBe(false);
 const again=await runChild([join(root,'dist/index.js'),...args(d,f.keyFiles),'--companion-input',f.paths.companion]);expect(again.code).not.toBe(0);expect(existsSync(join(d,'output',stage))).toBe(true);
});
it('does not erase an operator replacement during failure cleanup',async()=>{
 const d=temp(),f=await fixture(d,{companion:true}),operator=join(d,'operator');mkdirSync(operator);writeFileSync(join(operator,'keep'),'operator-marker');
 const output=join(d,'output');const base=localInputs(f.paths);
 const inputs={async *open(c:typeof f.set.components[number],s:AbortSignal){if(c.role==='companion'){const stage=readdirSync(output)[0];renameSync(join(output,stage),join(d,'moved-stage'));symlinkSync(operator,join(output,stage));throw Error('failure');}yield*base.open(c,s);}};
 await expect(recoverSet(f.set,inputs,async()=>f.keys[0],{mode:'extract',output})).rejects.toThrow();expect(readFileSync(join(operator,'keep'),'utf8')).toBe('operator-marker');expect(existsSync(join(output,'content'))).toBe(false);
});
it('real write ENOSPC after private staging publishes no successful set',async()=>{
 const d=temp(),f=await fixture(d);const loader=join(d,'disk-full.mjs');
 writeFileSync(loader,`import {open} from 'node:fs/promises';const h=await open(${JSON.stringify(f.paths.dump)},'r');const proto=Object.getPrototypeOf(h);await h.close();const write=proto.write;proto.write=async function(...args){throw Object.assign(Error('synthetic disk full'),{code:'ENOSPC'});};`);
 const r=await runChild(['--import',loader,join(root,'dist/index.js'),...args(d,f.keyFiles)]);expect(r.code).not.toBe(0);expect(existsSync(join(d,'output/content'))).toBe(false);expect(r.out).toBe('');expect(r.err).not.toContain('SYNTHETIC_SQL_MARKER');
});
it('streams 256 MiB input with measured RSS delta at most 96 MiB in a fresh process',async()=>{
 const d=temp();const prepared=spawnSync(process.execPath,[join(root,'test/helpers/recovery-worker.mjs'),root,'prepare-large',d],{encoding:'utf8',timeout:60000});expect(prepared.status,prepared.stderr).toBe(0);
 const child=await runChild([join(root,'test/helpers/recovery-worker.mjs'),root,'memory',d]);expect(child.code,child.err).toBe(0);const rss=JSON.parse(child.out);process.stdout.write('RECOVERY_RSS '+JSON.stringify({...rss,platform:process.platform,arch:process.arch,inputBytes:statSync(join(d,'large.arcn')).size})+'\n');
 expect(statSync(join(d,'output/content/database.sql')).size).toBe(256*1024*1024);expect(rss.deltaRss).toBeLessThanOrEqual(96*1024*1024);
},120000);
function validS3Signature(req:IncomingMessage):boolean {
 const match=/^AWS4-HMAC-SHA256 Credential=synthetic-access\/([0-9]{8})\/eu-west-1\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(req.headers.authorization??'');if(!match)return false;
 const url=new URL(req.url!,'https://localhost'),[_,date,signedHeaders,signature]=match;
 const query=[...url.searchParams.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv)).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
 const headers=signedHeaders.split(';').map(name=>`${name}:${String(req.headers[name]).trim().replace(/\s+/g,' ')}\n`).join('');
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const canonical=[req.method,url.pathname,query,headers,signedHeaders,req.headers['x-amz-content-sha256']].join('\n');
 const stringToSign=['AWS4-HMAC-SHA256',req.headers['x-amz-date'],`${date}/eu-west-1/s3/aws4_request`,hash(canonical)].join('\n');
 let key=createHmac('sha256','AWS4synthetic-secret').update(date).digest();for(const value of ['eu-west-1','s3','aws4_request'])key=createHmac('sha256',key).update(value).digest();
 const expected=createHmac('sha256',key).update(stringToSign).digest();return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
async function s3Server(d:string,bytes:Buffer,mode:string){
 const key=join(d,'tls.key'),cert=join(d,'tls.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const requests:Array<{method:string|undefined;url:string|undefined;authorization:boolean}>=[];
 let redirectRequests=0;const redirected=createServer({key:readFileSync(key),cert:readFileSync(cert)},(_req,res)=>{redirectRequests++;res.end('must never receive credentials');});
 await new Promise<void>(r=>redirected.listen(0,'127.0.0.1',r));const redirectAddress=redirected.address();if(!redirectAddress||typeof redirectAddress==='string')throw Error('listen');
 const server=createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  requests.push({method:req.method,url:req.url,authorization:validS3Signature(req)});
  if(!validS3Signature(req)){res.writeHead(403);res.end();return;}
  const url=new URL(req.url!,'https://localhost');
  if(!['HEAD','GET'].includes(req.method!)||url.pathname!=='/synthetic-bucket/dump.enc'||url.searchParams.get('versionId')!==(mode==='history'?null:'dump-version-2')){res.writeHead(404);res.end();return;}
  if(mode==='redirect'){res.writeHead(307,{Location:`https://127.0.0.1:${redirectAddress.port}/stolen`});res.end();return;}
  if(mode==='delete'){res.writeHead(405,{'x-amz-delete-marker':'true','x-amz-version-id':'dump-version-2'});res.end();return;}
  const version=mode==='wrong-version'?'substitute-version':'dump-version-2';
  res.writeHead(200,{'content-length':bytes.length,...(mode==='history'?{}:{'x-amz-version-id':version}),'content-type':'application/octet-stream'});
  if(req.method==='HEAD'){res.end();return;}
  if(mode==='stream-failure'){res.write(bytes.subarray(0,32));setImmediate(()=>res.destroy());return;}
  if(mode==='stall'){return;}
  res.end(bytes);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('listen');
 return{requests,redirectRequests:()=>redirectRequests,config:{endpoint:`https://127.0.0.1:${address.port}`,region:'eu-west-1',bucket:'synthetic-bucket',accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret',tlsCaPem:readFileSync(cert,'utf8'),deadlineMs:1000},async close(){server.closeAllConnections();redirected.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>redirected.close(()=>r()))]);}};
}
it.each(['valid','wrong-version','delete','stream-failure','redirect','stall'])('local disposable TLS S3-compatible transport %s uses only exact Head/Get and never fallback',async mode=>{
 const d=temp(),f=await fixture(d),server=await s3Server(d,f.dump,mode),source=s3Inputs(server.config),output=join(d,'output');
 try{const action=recoverSet(f.set,source,async()=>f.keys[0],{mode:'extract',output});if(mode==='valid'){await expect(action).resolves.toMatchObject({authenticated:true});expect(readFileSync(join(output,'content/database.sql'))).toEqual(f.plain);}else{await expect(action).rejects.toThrow();expect(existsSync(join(output,'content'))).toBe(false);}
 expect(server.requests.length).toBeGreaterThan(0);expect(server.requests.every(r=>r.authorization&&['HEAD','GET'].includes(r.method!)&&r.url!.includes('versionId=dump-version-2'))).toBe(true);expect(server.requests.length).toBeLessThanOrEqual(3);expect(server.redirectRequests()).toBe(0);
 }finally{source.dispose();await server.close();}
});
it.skipIf(process.platform !== 'darwin')('genuine ENOSPC on an owned disposable 64 MiB disk image never publishes content',async()=>{
 const d=temp(),mount=join(d,'mount'),image=join(d,'bounded.dmg');mkdirSync(mount);
 execFileSync('hdiutil',['create','-size','64m','-fs','HFS+','-volname','SyntheticRecoveryOnly','-type','UDIF',image],{stdio:'pipe'});
 let attached=false;
 try{
  execFileSync('hdiutil',['attach',image,'-mountpoint',mount,'-nobrowse','-noautoopen'],{stdio:'pipe'});attached=true;
  const privateParent=join(mount,'private');mkdirSync(privateParent,{mode:0o700});chmodSync(privateParent,0o700);
  const f=await fixture(d,{compression:'gzip',plain:Buffer.alloc(80*1024*1024,65)}),output=join(privateParent,'output');
  const source=localInputs(f.paths);let failure:unknown;
  try{await recoverSet(f.set,source,async()=>f.keys[0],{mode:'extract',output,minFreeBytes:1});}catch(e){failure=e;}
  expect(failure).toMatchObject({code:'ENOSPC'});expect(existsSync(join(output,'content'))).toBe(false);
  process.stdout.write('RECOVERY_ENOSPC '+JSON.stringify({platform:process.platform,volumeBytes:64*1024*1024,expandedBytes:80*1024*1024,code:(failure as {code:string}).code})+'\n');
 }finally{if(attached)execFileSync('hdiutil',['detach',mount],{stdio:'pipe'});}
},120000);
it('actual CLI reads protected TLS S3 credentials explicitly despite hostile ambient AWS selectors',async()=>{
 const d=temp(),f=await fixture(d),server=await s3Server(d,f.dump,'valid'),config=join(d,'s3.json');writeFileSync(config,JSON.stringify(server.config),{mode:0o600});
 const previous=process.env.AWS_ACCESS_KEY_ID;process.env.AWS_ACCESS_KEY_ID='HOSTILE_AMBIENT_KEY';
 try{const result=await runChild([join(root,'dist/index.js'),'recovery','extract','--s3-config',config,'--manifest',join(d,'manifest.json'),'--expect',join(d,'selection.json'),'--key-file',f.keyFiles[0],'--output',join(d,'output'),'--json','--debug']);
 expect(result.code,result.err).toBe(0);expect(JSON.parse(result.out).authenticated).toBe(true);expect(result.out+result.err).not.toMatch(/synthetic-secret|HOSTILE_AMBIENT_KEY|SYNTHETIC_SQL_MARKER/);expect(server.requests.every(r=>r.authorization)).toBe(true);expect(server.requests.map(r=>r.method)).toEqual(['HEAD','GET']);
 }finally{if(previous===undefined)delete process.env.AWS_ACCESS_KEY_ID;else process.env.AWS_ACCESS_KEY_ID=previous;await server.close();}
});
it('SIGTERM cancels an actual CLI remote stream and leaves no success or content',async()=>{
 const d=temp(),f=await fixture(d),server=await s3Server(d,f.dump,'stall'),config=join(d,'s3.json');writeFileSync(config,JSON.stringify({...server.config,deadlineMs:30000}),{mode:0o600});
 const child=spawn(process.execPath,[join(root,'dist/index.js'),'recovery','extract','--s3-config',config,'--manifest',join(d,'manifest.json'),'--expect',join(d,'selection.json'),'--key-file',f.keyFiles[0],'--output',join(d,'output')],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=String(b));
 try{await new Promise<void>((resolve,reject)=>{const started=Date.now();const poll=setInterval(()=>{if(server.requests.some(r=>r.method==='GET')){clearInterval(poll);resolve();}else if(Date.now()-started>5000){clearInterval(poll);reject(Error('request never reached local server'));}},5);});child.kill('SIGTERM');const [code]=await once(child,'exit');expect(code).not.toBe(0);expect(out).toBe('');expect(existsSync(join(d,'output/content'))).toBe(false);}
 finally{if(child.exitCode===null)child.kill('SIGKILL');await server.close();}
});
it('rejects an untrusted TLS certificate without sending signed HTTP requests',async()=>{
 const d=temp(),f=await fixture(d),server=await s3Server(d,f.dump,'valid'),source=s3Inputs({...server.config,tlsCaPem:undefined});
 try{await expect(recoverSet(f.set,source,async()=>f.keys[0],{mode:'verify',temporaryParent:d})).rejects.toThrow();expect(server.requests).toEqual([]);}finally{source.dispose();await server.close();}
});
it('historical unversioned S3 requires exact trusted bytes/digest and does not claim object immutability',async()=>{
 const d=temp(),f=await fixture(d,{versionId:null}),server=await s3Server(d,f.dump,'history'),source=s3Inputs(server.config);
 try{const result=await recoverSet(f.set,source,async()=>f.keys[0],{mode:'verify',temporaryParent:d});expect(result.ciphertext[0]).toMatchObject({versionId:null,previouslyPinned:true});expect(server.requests.map(r=>r.method)).toEqual(['HEAD','GET']);expect(server.requests.every(r=>!r.url!.includes('versionId'))).toBe(true);
 const missing=structuredClone(f.set);missing.components[0].encryptedSha256=null;const count=server.requests.length;
 await expect(recoverSet(missing,source,async()=>f.keys[0],{mode:'verify',temporaryParent:d})).rejects.toThrow();expect(server.requests.length).toBe(count);
 }finally{source.dispose();await server.close();}
});
it('local S3 service rejects incorrect explicit credentials without falling back to ambient credentials',async()=>{
 const d=temp(),f=await fixture(d),server=await s3Server(d,f.dump,'valid'),source=s3Inputs({...server.config,secretAccessKey:'wrong-explicit-secret'});
 try{await expect(recoverSet(f.set,source,async()=>f.keys[0],{mode:'verify',temporaryParent:d})).rejects.toThrow();expect(server.requests).toHaveLength(1);expect(server.requests[0].authorization).toBe(false);}finally{source.dispose();await server.close();}
});
