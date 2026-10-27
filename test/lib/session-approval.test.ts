import https from 'node:https';
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {store,setRuntimeProfile,invalidateAllProfileCaches,getActiveProfileName} from '../../src/lib/config.js';
import {withApprovalSession,approveWithIPhone,approveWithTOTP,getApprovalStatus,closeUserSealedAccess} from '../../src/lib/session-approval.js';
import {VaultClient} from '../../src/lib/client.js';
import {Command} from 'commander';
import {registerUnsealCommands} from '../../src/commands/unseal.js';

const token=(family='family-a',user='human-a')=>`e30.${Buffer.from(JSON.stringify({sub:user,username:user,tenantId:'tenant',authEpoch:1,refreshFamilyId:family,userSealedSessionKey:'public-synthetic-capability'})).toString('base64url')}.fixture`;
const profile=(name:string)=>({url:`https://${name}.example.test`,insecure:false,timeout:1000,
  credentials:{accessToken:token(name==='a'?'family-a':'family-b',name==='a'?'human-a':'human-b'),refreshToken:`public-refresh-${name}`,expiresAt:Date.now()+3600000,userId:`human-${name}`,username:`human-${name}`,role:'user' as const,tenantId:'tenant'}});
const window={required:true,approved:true,method:'iphone',expiresAt:new Date(Date.now()+900000).toISOString()};
interface Sent {hostname:string;path:string;body:Record<string,unknown>;authorization:string|undefined}
vi.mock('../../src/lib/client/refresh-lock.js',()=>({computeLockKey:()=> 'synthetic-lock',acquireRefreshLock:async()=>null}));
let sent:Sent[],unlocked=true,approved=true,lost=false,unauthorized=false,rejectPath='',approvalDenied=false,htmlFailure=false;
let onRequest:(request:Sent)=>void;
beforeEach(()=>{
  sent=[];unlocked=true;approved=true;lost=false;unauthorized=false;rejectPath='';approvalDenied=false;htmlFailure=false;onRequest=()=>{};
  store.set('profiles',{a:profile('a'),b:profile('b')});store.set('activeProfile','a');setRuntimeProfile(null);invalidateAllProfileCaches();
  for(const key of ['ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD','ZNVAULT_URL','ZNVAULT_PROFILE'])vi.stubEnv(key,undefined);
  vi.spyOn(https,'request').mockImplementation((options,callback)=>{
    const opts=options as https.RequestOptions,request:Sent={hostname:String(opts.hostname),path:String(opts.path),body:{},authorization:(opts.headers as Record<string,string>).Authorization};sent.push(request);
    const req=new EventEmitter() as EventEmitter&{write:(data:string)=>void;end:()=>void;destroy:()=>void};
    req.write=data=>{request.body=JSON.parse(data) as Record<string,unknown>;};req.destroy=()=>{};
    req.end=()=>{
      onRequest(request);
      if(lost&&request.path.endsWith('/complete')){req.emit('error',new Error('Synthetic lost response'));return;}
      let body:unknown={};
      if(request.path==='/auth/refresh')body={accessToken:token().replace('.fixture','.successor'),refreshToken:'public-refresh-successor',expiresIn:3600};
      else if(request.path==='/auth/mfa/iphone/devices')body={devices:[{id:'phone-a',name:'Public fixture phone',ready:true,state:'active'}]};
      else if(request.path.endsWith('/start'))body={requestId:'request-a',claimant:'public-synthetic-claimant',comparisonNumber:'42',expiresAt:Math.floor(Date.now()/1000)+120,pushStatus:'sent'};
      else if(request.path.endsWith('/iphone/status'))body={state:'approved'};
      else if(request.path==='/v1/user-sealed/status')body={unlocked,method:'password',approval:{...window,approved}};
      else if(request.path.includes('/auth/unseal/status'))body={unsealed:approved,unsealedUntil:window.expiresAt,method:'iphone',scope:'crypto'};
      else if(request.path.endsWith('/complete')||request.path.endsWith('/totp'))body={approval:window};
      const response=new EventEmitter() as EventEmitter&{statusCode:number;headers:object};response.statusCode=request.path===rejectPath||unauthorized&&request.path.endsWith('/complete')?401:request.path.endsWith('/start')?202:200;response.headers={};
      if(approvalDenied){response.statusCode=403;body={code:'USER_SEALED_APPROVAL_REQUIRED',message:'Approval required'};}
      if(htmlFailure&&request.path.endsWith('/complete'))response.statusCode=503;
      (callback as (response:unknown)=>void)(response);response.emit('data',Buffer.from(htmlFailure&&request.path.endsWith('/complete')?'<html>Public proxy error fixture</html>':JSON.stringify(body)));response.emit('end');
    };
    return req as unknown as ReturnType<typeof https.request>;
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();setRuntimeProfile(null);invalidateAllProfileCaches();});

describe('session approval binds the named profile, actor and refresh family',()=>{
  it('uses the initiating profile even if another process changes only the default',async()=>{
    const other=structuredClone(store.get('profiles').b);
    onRequest=request=>{if(request.path.endsWith('/start'))store.set('activeProfile','b');};
    const result=await withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}));
    expect(result).toMatchObject({approval:{approved:true}});
    expect(sent.every(request=>request.hostname==='a.example.test'&&request.authorization===`Bearer ${token()}`)).toBe(true);
    expect(store.get('profiles').b).toEqual(other);expect(getActiveProfileName()).toBe('b');
    expect(JSON.stringify(result)).not.toContain('claimant');expect(JSON.stringify(result)).not.toContain('public-synthetic-capability');
  });
  for(const change of ['family','user','origin'] as const)it(`stops before any further request if ${change} changes`,async()=>{
    onRequest=request=>{
      if(!request.path.endsWith('/start'))return;
      const profiles=store.get('profiles');
      if(change==='origin')profiles.a.url='https://elsewhere.example.test';
      else profiles.a.credentials!.accessToken=token(change==='family'?'other-family':'family-a',change==='user'?'other-human':'human-a');
      store.set('profiles',profiles);invalidateAllProfileCaches();
    };
    await expect(withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}))).rejects.toThrow('SESSION_APPROVAL_CONTEXT_CHANGED');
    expect(sent.filter(request=>request.path.endsWith('/complete'))).toHaveLength(0);
    expect(sent.every(request=>request.hostname==='a.example.test')).toBe(true);
  });
  it('accepts a refresh successor only in the same actor/family',async()=>{
    onRequest=request=>{if(request.path.endsWith('/start')){
      const profiles=store.get('profiles');profiles.a.credentials!.accessToken=token().replace('.fixture','.successor');store.set('profiles',profiles);invalidateAllProfileCaches();
    }};
    expect(await withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}))).toMatchObject({approval:{approved:true}});
  });
  it.each([true,false])('checks the actual window after a lost complete response (installed=%s), never repeats the POST',async installed=>{
    lost=true;approved=installed;
    const operation=withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}));
    if(installed)expect(await operation).toMatchObject({approval:{approved:true}});
    else await expect(operation).rejects.toThrow('SESSION_APPROVAL_OUTCOME_UNKNOWN');
    expect(sent.filter(request=>request.path.endsWith('/complete'))).toHaveLength(1);
  });
  it('does not ask for TOTP or phone approval when the primary key is unavailable',async()=>{
    unlocked=false;const read=vi.fn(async()=>'123456');
    await expect(withApprovalSession(async session=>await approveWithTOTP(session,'user-sealed',read))).rejects.toThrow('SECRET_REQUIRES_USER_SESSION');
    expect(read).not.toHaveBeenCalled();expect(sent.filter(request=>request.path.endsWith('/totp'))).toHaveLength(0);
    await expect(withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}))).rejects.toThrow('SECRET_REQUIRES_USER_SESSION');
    expect(sent.filter(request=>request.path.endsWith('/start'))).toHaveLength(0);
  });
  it('permits status and closure without the primary key and sends only the explicit TOTP',async()=>{
    unlocked=false;
    const status=await withApprovalSession(async session=>await getApprovalStatus(session,'user-sealed'));expect(status).toMatchObject({unlocked:false});
    await withApprovalSession(async session=>await closeUserSealedAccess(session));expect(sent.at(-1)?.body).toEqual({});
    unlocked=true;await withApprovalSession(async session=>await approveWithTOTP(session,'user-sealed',async()=>'123456'));
    expect(sent.find(request=>request.path.endsWith('/totp'))?.body).toEqual({totpCode:'123456'});
  });
  it('rejects API keys and ambient authentication before any transmission',async()=>{
    vi.stubEnv('ZNVAULT_API_KEY','public-ambient-key');
    await expect(withApprovalSession(async session=>await getApprovalStatus(session,'user-sealed'))).rejects.toThrow('SESSION_APPROVAL_HUMAN_SESSION_REQUIRED');
    expect(sent).toEqual([]);
  });
  it('never refreshes and replays a rejected approval POST',async()=>{
    unauthorized=true;
    await expect(withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}))).rejects.toThrow();
    expect(sent.filter(request=>request.path.endsWith('/complete'))).toHaveLength(1);
    expect(sent.filter(request=>request.path==='/auth/refresh')).toHaveLength(0);
  });
  it('does not overwrite a new login that arrives while refreshing the initiating session',async()=>{
    const profiles=store.get('profiles');profiles.a.credentials!.expiresAt=Date.now()-1;store.set('profiles',profiles);invalidateAllProfileCaches();
    onRequest=request=>{if(request.path==='/auth/refresh'){
      const values=store.get('profiles');values.a.credentials!.accessToken=token('new-login-family');store.set('profiles',values);invalidateAllProfileCaches();
    }};
    await expect(withApprovalSession(async session=>await getApprovalStatus(session,'user-sealed'))).rejects.toThrow('SESSION_APPROVAL_CONTEXT_CHANGED');
    expect(store.get('profiles').a.credentials!.accessToken).toBe(token('new-login-family'));
    expect(sent.filter(request=>request.path==='/v1/user-sealed/status')).toHaveLength(0);
  });
  it('legacy OTP unseal is not replayed after a 401 either',async()=>{
    rejectPath='/v1/auth/unseal';
    await expect(new VaultClient().post(rejectPath,{totpCode:'123456'})).rejects.toThrow();
    expect(sent.filter(request=>request.path===rejectPath)).toHaveLength(1);
    expect(sent.filter(request=>request.path==='/auth/refresh')).toHaveLength(0);
  });
  it('requests the actual root status with a query, not an encoded path',async()=>{
    await withApprovalSession(async session=>await getApprovalStatus(session,'unseal','root'));
    expect(sent[0].path).toBe('/v1/auth/unseal/status?scope=root');
  });
  it('cancels a pending phone request on interruption without clearing the login',async()=>{
    const controller=new AbortController();
    onRequest=request=>{if(request.path.endsWith('/start'))controller.abort();};
    const saved=structuredClone(store.get('profiles').a.credentials);
    await expect(withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{signal:controller.signal}))).rejects.toThrow();
    expect(sent.filter(request=>request.path.endsWith('/cancel'))).toHaveLength(1);
    expect(sent.filter(request=>request.path.endsWith('/complete'))).toHaveLength(0);
    expect(store.get('profiles').a.credentials).toEqual(saved);
  });
  it('gives an explicit approval command for a denied secret read, without retrying it',async()=>{
    approvalDenied=true;
    await expect(new VaultClient().post('/v1/secrets/public-fixture/decrypt',{})).rejects.toThrow('znvault user-sealed approve --iphone');
    expect(sent).toHaveLength(1);
  });
  it.each(['root','all'])('seal --scope %s remains in its initiating family during refresh and a changed default',async scope=>{
    vi.spyOn(console,'log').mockImplementation(()=>{});
    const other=structuredClone(store.get('profiles').b),profiles=store.get('profiles');
    profiles.a.credentials!.expiresAt=Date.now()-1;store.set('profiles',profiles);invalidateAllProfileCaches();
    onRequest=request=>{if(request.path==='/auth/refresh')store.set('activeProfile','b');};
    const program=new Command();registerUnsealCommands(program);
    await program.parseAsync(['node','test','seal','--scope',scope,'--json']);
    const close=sent.find(request=>request.path===`/v1/auth/unseal/seal?scope=${scope}`);
    expect(close).toMatchObject({hostname:'a.example.test',authorization:`Bearer ${token().replace('.fixture','.successor')}`});
    expect(store.get('profiles').b).toEqual(other);expect(getActiveProfileName()).toBe('b');
  });
  it('a non-JSON HTTP503 remains a definitive error even with a prior live window',async()=>{
    htmlFailure=true;
    await expect(withApprovalSession(async session=>await approveWithIPhone(session,'user-sealed',{}))).rejects.toMatchObject({statusCode:503});
    expect(sent.filter(request=>request.path.endsWith('/complete'))).toHaveLength(1);
  });
  it('seal all aborts a replaced login during refresh without closing or overwriting it',async()=>{
    vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.spyOn(process,'exit').mockImplementation(()=>{throw new Error('Expected command failure');});
    const profiles=store.get('profiles');profiles.a.credentials!.expiresAt=Date.now()-1;store.set('profiles',profiles);invalidateAllProfileCaches();
    onRequest=request=>{if(request.path==='/auth/refresh'){
      const values=store.get('profiles');values.a.credentials!.accessToken=token('new-login-family');store.set('profiles',values);invalidateAllProfileCaches();
    }};
    const program=new Command();registerUnsealCommands(program);
    await expect(program.parseAsync(['node','test','seal','--scope','all','--json'])).rejects.toThrow('Expected command failure');
    expect(store.get('profiles').a.credentials!.accessToken).toBe(token('new-login-family'));
    expect(sent.filter(request=>request.path.includes('/unseal/seal'))).toHaveLength(0);
  });
});
