import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../helpers/recovery-fixture.js';
import {store} from '../../src/lib/config/store.js';
import {createVaultKeyProvider,createRecoveryClient} from '../../src/lib/recovery/vault-key-provider.js';
import {loadKeyFiles} from '../../src/lib/recovery/protected-files.js';

const offsiteOrigin='https://offsite.invalid';
let directory:string, f:Awaited<ReturnType<typeof fixture>>, paths:string[], auth:string[], requestIds:string[], reply:(path:string)=>unknown, afterReply:()=>void,status:number;
beforeEach(async()=>{
 directory=mkdtempSync(join(tmpdir(),'recovery-assisted-'));f=await fixture(directory,{companion:true,managedKeys:true});paths=[];auth=[];requestIds=[];afterReply=()=>{};status=200;
 store.set('profiles',{main:{url:'https://main.invalid',insecure:false,timeout:1000,apiKey:'MAIN_MARKER'},offsite:{url:offsiteOrigin,insecure:false,timeout:1000,credentials:{accessToken:'OFFSITE_MARKER',refreshToken:'NEVER_REFRESH',expiresAt:Date.now()+60000,userId:'human',username:'human',role:'user',tenantId:'lab'}}});store.set('activeProfile','main');
 vi.stubEnv('ZNVAULT_URL','https://hostile.invalid');vi.stubEnv('ZNVAULT_API_KEY','ENV_MARKER');vi.stubEnv('ZNVAULT_USERNAME','env');vi.stubEnv('ZNVAULT_PASSWORD','env');
 reply=path=>{const i=path.includes('222222222221')||path.includes('444444444441')?1:0;const key=f.expected.keyBindings[i].key;
 if(path.includes('/resolve'))return {secretId:`44444444-4444-4444-8444-44444444444${i}`,dataVersion:1,sourceIdentity:key,fingerprint:key.fingerprint};
 if(path.endsWith('/meta'))return {version:2};
 return {id:`44444444-4444-4444-8444-44444444444${i}`,version:1,data:{key:f.keys[i].toString('hex')}};};
 vi.spyOn(https,'request').mockImplementation(((options:any,callback:any)=>{paths.push(`https://${options.hostname}${options.path}`);requestIds.push(options.headers['X-Request-ID']);auth.push(options.headers.Authorization??options.headers['X-API-Key']);expect(options.rejectUnauthorized).toBe(true);
 const req=new EventEmitter() as any;req.write=()=>{};req.destroy=()=>{};req.end=()=>{queueMicrotask(()=>{const res=new EventEmitter() as any;res.statusCode=status;res.headers={};callback(res);res.emit('data',JSON.stringify(reply(options.path)));afterReply();res.emit('end');});};return req;}) as any);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
const request=()=>({selection:f.expected,requestId:'synthetic-request',signal:new AbortController().signal});
describe('assisted exact native profile',()=>{
 it('binds origin AND native auth and uses exact receiver history for independently keyed components; erases original buffers',async()=>{
  const provider=createVaultKeyProvider('offsite',request());const buffers:Buffer[]=[];
  try{for(const b of f.expected.keyBindings)buffers.push(await provider(b.key,new AbortController().signal));expect(buffers).toEqual(f.keys);expect([...new Set(paths.map(p=>new URL(p).origin))]).toEqual([offsiteOrigin]);expect(new Set(auth)).toEqual(new Set(['Bearer OFFSITE_MARKER']));expect(paths.filter(p=>p.includes('history/1/decrypt'))).toHaveLength(2);}finally{provider.dispose();}
  expect(buffers.every(b=>b.every(v=>v===0))).toBe(true);
 });
 it('correlates native metadata and value requests with the public recovery request id',async()=>{
  const provider=createVaultKeyProvider('offsite',request());try{await provider(f.expected.keyBindings[0].key,new AbortController().signal);expect(requestIds).toEqual(['synthetic-request','synthetic-request','synthetic-request']);}finally{provider.dispose();}
 });
 it('rejects unknown and unauthenticated explicit profile before transport, never env login',()=>{
  expect(()=>createRecoveryClient('unknown')).toThrow();const profiles=store.get('profiles');delete profiles.offsite.credentials;store.set('profiles',profiles);expect(()=>createRecoveryClient('offsite')).toThrow();expect(paths).toEqual([]);
 });
 it('rejects unsafe TLS and changed profile before consuming returned material',async()=>{
  const provider=createVaultKeyProvider('offsite',request());afterReply=()=>{const profiles=store.get('profiles');profiles.offsite.url='https://changed.invalid';store.set('profiles',profiles);};
  await expect(provider(f.expected.keyBindings[0].key,new AbortController().signal)).rejects.toThrow();provider.dispose();expect(paths).toHaveLength(1);
  expect(()=>createRecoveryClient('main')).not.toThrow();const profiles=store.get('profiles');profiles.offsite.insecure=true;store.set('profiles',profiles);expect(()=>createRecoveryClient('offsite')).toThrow();
 });
 it.each([401,403,500])('sanitizes HTTP %s bodies and never refreshes/retries/falls back',async code=>{
  status=code;reply=()=>({message:'KEY_MARKER',details:{key:'KEY_MARKER'}});
  const client=createRecoveryClient('offsite');let caught:unknown;try{await client.request({method:'GET',path:'/v1/secrets/synthetic/meta'});}catch(e){caught=e;}
  expect(caught).toBeInstanceOf(Error);expect(String(caught)+JSON.stringify(caught)).not.toContain('KEY_MARKER');expect(paths).toHaveLength(1);expect(paths[0]).toContain(offsiteOrigin);
 });
 it('rejects expired chosen sessions without using an environment API key',()=>{
  const profiles=store.get('profiles');profiles.offsite.credentials!.expiresAt=1;store.set('profiles',profiles);
  expect(()=>createRecoveryClient('offsite')).toThrow('recovery_native_login_required');expect(paths).toEqual([]);
 });
 it('refuses transport reconfiguration after the named profile snapshot',()=>{expect(()=>createRecoveryClient('offsite').configure('https://main.invalid')).toThrow('recovery_transport_frozen');});
 it('cancels during returned value processing and erases earlier component buffers',async()=>{
  const controller=new AbortController(),provider=createVaultKeyProvider('offsite',{...request(),signal:controller.signal});
  const buffer=await provider(f.expected.keyBindings[0].key,controller.signal);afterReply=()=>controller.abort();
  await expect(provider(f.expected.keyBindings[1].key,controller.signal)).rejects.toThrow();expect(buffer.every(v=>v===0)).toBe(true);provider.dispose();
 });
 it('decodes native file-shaped64hexLF without using its filename',async()=>{
  const original=reply;reply=path=>{const value=original(path) as any;if(path.includes('/decrypt'))value.data={filename:'/never/open',content:Buffer.from(f.keys[0].toString('hex')+'\n').toString('base64')};return value;};
  const provider=createVaultKeyProvider('offsite',request());expect(await provider(f.expected.keyBindings[0].key,new AbortController().signal)).toEqual(f.keys[0]);provider.dispose();
 });
 it.each(['wrong-version','wrong-descriptor','wrong-key','ambiguous-value'])('fails closed on %s',async kind=>{
  const original=reply;reply=path=>{const value=original(path) as any;if(kind==='wrong-version'&&path.includes('/decrypt'))value.version=2;if(kind==='wrong-descriptor'&&path.includes('/resolve'))value.sourceIdentity={...value.sourceIdentity,sourceDataVersion:999};if(kind==='wrong-key'&&path.includes('/decrypt'))value.data={key:'ff'.repeat(32)};if(kind==='ambiguous-value'&&path.includes('/decrypt'))value.data.other='KEY_MARKER';return value;};
  const provider=createVaultKeyProvider('offsite',request());await expect(provider(f.expected.keyBindings[0].key,new AbortController().signal)).rejects.toThrow();provider.dispose();
 });
 it('erases borrowed buffers immediately on cancellation and rejects subsequent use',async()=>{
  const controller=new AbortController();const provider=createVaultKeyProvider('offsite',{...request(),signal:controller.signal});const buffer=await provider(f.expected.keyBindings[0].key,controller.signal);controller.abort();expect(buffer.every(v=>v===0)).toBe(true);await expect(provider(f.expected.keyBindings[1].key,controller.signal)).rejects.toThrow();provider.dispose();
 });
 it.each(['hex','hex-lf'])('reads protected existing %s key files with shared codec',async format=>{
  f.keyFiles.forEach((p,i)=>writeFileSync(p,f.keys[i].toString('hex')+(format==='hex-lf'?'\n':''),{mode:0o600}));
  const keys=await loadKeyFiles(f.keyFiles,f.set);const buffers=await Promise.all(f.expected.keyBindings.map(b=>keys.get(b.key,new AbortController().signal)));expect(buffers).toEqual(f.keys);keys.dispose();expect(buffers.every(b=>b.every(v=>v===0))).toBe(true);
 });
});
