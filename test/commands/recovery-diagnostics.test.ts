import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from '../helpers/recovery-fixture.js';
const directory=mkdtempSync(join(tmpdir(),'recovery-diagnostics-'));
const cli=process.env.RECOVERY_DIAGNOSTICS_CLI??resolve('dist/index.js');
const config=join(directory,'config'),network=join(directory,'network.jsonl'),hook=join(directory,'guard.mjs'),output=join(directory,'never-published');
const marker=/PROFILE_SECRET_MARKER|CREDENTIAL_SECRET_MARKER|REMOTE_BODY_SECRET_MARKER|KEY_SECRET_MARKER|ARG_SECRET_MARKER/;
const messages={
 unknown:'Recovery prerequisite: the selected profile is not configured. Check the explicit --profile name, then explicitly retry recovery.',
 login:'Recovery prerequisite: native login is required for the selected profile. Run znvault --profile PROFILE_NAME login using that same profile, then explicitly retry recovery.',
 tls:'Recovery prerequisite: the selected profile requires a valid HTTPS origin and verified TLS. Correct its HTTPS/TLS prerequisites, then explicitly retry recovery. Insecure TLS is not permitted.',
 generic:'Recovery error: recovery_failed',
};
const credentials=()=>({accessToken:'CREDENTIAL_SECRET_MARKER',refreshToken:'CREDENTIAL_SECRET_MARKER',expiresAt:Date.now()+60000,userId:'synthetic',username:'synthetic',role:'user',tenantId:'synthetic'});
function profiles(kind:string){
 const offsite:any={url:'https://offsite.invalid',insecure:false,timeout:1000,credentials:credentials()};
 if(kind==='missing')delete offsite.credentials;
 if(kind==='expired')offsite.credentials.expiresAt=1;
 if(kind==='pending')offsite.credentials.pendingRefresh={presentedJti:'synthetic',startedAt:Date.now()};
 if(kind==='insecure')offsite.insecure=true;
 if(kind==='http')offsite.url='http://offsite.invalid';
 if(kind==='malformed-url')offsite.url='INVALID_URL_CREDENTIAL_SECRET_MARKER';
 writeFileSync(join(config,'config.json'),JSON.stringify({activeProfile:'main',profiles:{main:{url:'https://main.invalid',insecure:false,timeout:1000,apiKey:'CREDENTIAL_SECRET_MARKER'},offsite}}),{mode:0o600});
}
function run(args:string[],status?:number){
 return spawnSync(process.execPath,['--import',hook,cli,...args],{encoding:'utf8',timeout:15000,cwd:directory,env:{...process.env,HOME:directory,ZNVAULT_CONFIG_DIR:config,ZNVAULT_PROFILE:'main',ZNVAULT_URL:'https://main.invalid',ZNVAULT_API_KEY:'CREDENTIAL_SECRET_MARKER',ZNVAULT_USERNAME:'CREDENTIAL_SECRET_MARKER',ZNVAULT_PASSWORD:'CREDENTIAL_SECRET_MARKER',...(status?{RECOVERY_DIAGNOSTIC_STATUS:String(status)}:{})}});
}
function assertSafe(result:ReturnType<typeof run>,message:string){
 expect(result.status,result.stderr).toBe(1);expect(result.stdout).toBe('');expect(result.stderr.trim()).toBe(message);
 expect(result.stdout+result.stderr).not.toMatch(marker);expect(existsSync(output)).toBe(false);
}
beforeAll(()=>{
 mkdirSync(config);
 writeFileSync(hook,`import {registerHooks,syncBuiltinESMExports} from 'node:module';import {appendFileSync} from 'node:fs';import {EventEmitter} from 'node:events';import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';
const record=v=>appendFileSync(${JSON.stringify(network)},JSON.stringify(v)+'\\n');const deny=()=>{record({forbidden:true});throw Error('REMOTE_BODY_SECRET_MARKER');};http.request=deny;http.get=deny;https.get=deny;net.connect=deny;net.createConnection=deny;tls.connect=deny;dns.lookup=deny;const originalFetch=globalThis.fetch;globalThis.fetch=(resource,...args)=>typeof resource==='string'&&resource.startsWith('data:')?originalFetch(resource,...args):deny();
https.request=(options,callback)=>{record({origin:'https://'+options.hostname,path:options.path,selectedAuth:options.headers.Authorization==='Bearer CREDENTIAL_SECRET_MARKER'});if(!process.env.RECOVERY_DIAGNOSTIC_STATUS)throw Error('REMOTE_BODY_SECRET_MARKER');const req=new EventEmitter();req.write=()=>{};req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=Number(process.env.RECOVERY_DIAGNOSTIC_STATUS);res.headers={};callback(res);res.emit('data',JSON.stringify({message:'recovery_native_login_required',code:'recovery_profile_unknown',details:'REMOTE_BODY_SECRET_MARKER'}));res.emit('end');});return req;};syncBuiltinESMExports();
registerHooks({load(url,context,next){if(/\\/dist\\/(?:main\\.js|plugins\\/|services\\/update)/.test(url))throw Error('ARG_SECRET_MARKER');return next(url,context);}});`);
});
beforeEach(()=>{writeFileSync(network,'');profiles('valid');});
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
for(const debug of [false,true]){
 it.each(['unknown','missing','expired','pending','insecure','http','malformed-url','pin'])('reports safe actionable %s prerequisite at command boundary; debug='+debug,kind=>{
  profiles(kind);const args=['--profile',kind==='unknown'?'PROFILE_SECRET_MARKER':'offsite',...(kind==='pin'?['--tls-spki-sha256','KEY_SECRET_MARKER']:[]),'recovery','extract','--key-source','vault','--expect','never-read','--manifest','never-read','--input','never-read','--output',output,'--json',...(debug?['--debug']:[])];
  assertSafe(run(args),messages[kind==='unknown'?'unknown':['missing','expired','pending'].includes(kind)?'login':'tls']);
  expect(readFileSync(network,'utf8')).toBe('');
 });
}
it.each([401,403,500])('retains generic fallback for native HTTP%s even when its body spoofs prerequisite codes',status=>{
 assertSafe(run(['--profile','offsite','recovery','extract','--key-source','vault','--backup','11111111-1111-4111-8111-111111111111','--manifest','never-read','--input','never-read','--output',output,'--json','--debug'],status),messages.generic);
 expect(readFileSync(network,'utf8').trim().split('\n').map(line=>JSON.parse(line))).toEqual([{origin:'https://offsite.invalid',path:'/v1/backup-recovery/records/11111111-1111-4111-8111-111111111111',selectedAuth:true}]);
});
it('never renders arbitrary parser or filesystem exception text as a prerequisite',()=>{
 assertSafe(run(['recovery','verify','--unknown=ARG_SECRET_MARKER','--json','--debug']),messages.generic);
 assertSafe(run(['recovery','verify','--expect','ARG_SECRET_MARKER','--manifest','ARG_SECRET_MARKER','--input','ARG_SECRET_MARKER','--key-file','KEY_SECRET_MARKER','--json','--debug']),messages.generic);
 expect(readFileSync(network,'utf8')).toBe('');
});
it('keeps codec failures generic and secret-free without publishing a receipt',async()=>{
 const f=await fixture(directory);writeFileSync(f.keyFiles[0],'KEY_SECRET_MARKER',{mode:0o600});
 assertSafe(run(['recovery','extract','--expect',join(directory,'selection.json'),'--manifest',join(directory,'manifest.json'),'--input',f.paths.dump,'--key-file',f.keyFiles[0],'--output',output,'--json','--debug']),messages.generic);
 expect(readFileSync(network,'utf8')).toBe('');f.keys.forEach(b=>b.fill(0));
});
