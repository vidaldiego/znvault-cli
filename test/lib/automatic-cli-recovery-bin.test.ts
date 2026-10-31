import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, beforeEach, expect, it} from 'vitest';

const root=resolve(__dirname,'../..'), id='11111111-1111-4111-8111-111111111111';
let scratch:string, server:Server, origin:string, paths:string[];
let grant:Record<string,unknown>;
const raw='synthetic\nraw-value';
beforeAll(()=>{
  execFileSync('npm',['run','build'],{cwd:root,stdio:'pipe'});
  scratch=mkdtempSync(join(tmpdir(),'znvault-auto-recovery-bin-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
    '-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
},180000);
afterAll(()=>rmSync(scratch,{recursive:true,force:true}));
beforeEach(async()=>{
  paths=[];const expiresAt=Math.floor(Date.now()/1000)+120, claimant=randomBytes(32).toString('base64url');
  server=createServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},(request,response)=>{
    request.resume();request.on('end',()=>{
      const path=request.url!;paths.push(path);let body:unknown;
      if(path.endsWith('/protocol')) body={protocolVersion:3,origin,installationId:grant.installationId,cliRecovery:{version:1,enabled:true}};
      else if(path.endsWith('/start')) body={requestId:id,claimant,comparisonNumber:'42',expiresAt};
      else if(path.endsWith('/status')) body={state:'approved',expiresAt};
      else if(path.endsWith('/complete')) body={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresIn:900,userSealedUnlocked:false,user:{id:'human',username:'human',role:'user',tenantId:'tenant'}};
      else if(path.endsWith('/decrypt')) {
        if(request.headers.authorization!=='Bearer synthetic-access') {response.writeHead(401);response.end('{}');return;}
        body={data:{value:raw}};
      } else {response.writeHead(500);response.end('{}');return;}
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));origin=`https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  grant={state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin,installationId:randomUUID(),expiresAtSec:Math.floor(Date.now()/1000)+2592000};
  writeFileSync(join(scratch,'config.json'),JSON.stringify({activeProfile:'fixture',profiles:{fixture:{url:origin,insecure:true,timeout:2000,authGeneration:randomUUID(),cliRecovery:grant}},plugins:[]}),{mode:0o600});
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});
async function run(flags:string[]):Promise<{code:number|null;stdout:string;stderr:string}> {
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('ZNVAULT_')&&key!=='DATABASE_URL'));
  const child=spawn(process.execPath,[join(root,'dist/index.js'),'--no-plugins','--quiet','secret','decrypt',id,...flags],{
    env:{...env,CI:'1',ZNVAULT_CONFIG_DIR:scratch,ZNVAULT_NO_PLUGINS:'1',ZNVAULT_NO_UPDATE_CHECK:'1'},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});
  // Keep stdin open: recovery must finish without consuming agent input.
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  try {return await new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));});}
  finally {clearTimeout(timer);child.stdin.destroy();}
}
it.each(['--raw','--json'])('preserves real piped %s output with quiet/CI and open stdin',async flag=>{
  const result=await run([flag]);expect(result.code).toBe(0);
  if(flag==='--raw') expect(result.stdout).toBe(raw);else expect(JSON.parse(result.stdout)).toEqual({data:{value:raw}});
  expect(result.stderr).toContain('Choose 42');expect(result.stdout).not.toContain('Recover CLI');
  expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths.filter(x=>x.endsWith('/decrypt'))).toHaveLength(1);
  const saved=JSON.parse(readFileSync(join(scratch,'config.json'),'utf8')).profiles.fixture.cliRecovery;
  expect(saved).toEqual(grant);
},20000);
