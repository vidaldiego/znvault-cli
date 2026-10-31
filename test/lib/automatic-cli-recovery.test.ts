import https from 'node:https';
import {EventEmitter} from 'node:events';
import {randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {store, setRuntimeProfile, getProfile, invalidateAllProfileCaches} from '../../src/lib/config.js';
import * as httpModule from '../../src/lib/client/http.js';
import {terminalCliRecovery} from '../../src/lib/qr-login-presentation.js';

const configure = (present = terminalCliRecovery) => httpModule.configureAutomaticRecovery?.({present});
let paths: string[], outcome: number, refreshStatus: number, pending: boolean;
let replace: (() => void) | undefined;
let recoveredExpiresIn: number;
let recoveryStatus: number;
let refreshMessage: string;
beforeEach(() => {
  for (const key of ['ZNVAULT_URL','ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD','ZNVAULT_LOCAL']) vi.stubEnv(key, undefined);
  paths=[];outcome=200;refreshStatus=401;pending=false;replace=undefined;recoveredExpiresIn=900;recoveryStatus=200;refreshMessage='fixture auth error';
  const grant={state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin:'https://vault.example.test',installationId:randomUUID(),expiresAtSec:Math.floor(Date.now()/1000)+2592000};
  store.set('profiles',{remembered:{url:grant.origin,insecure:false,timeout:1000,authGeneration:randomUUID(),cliRecovery:grant}});
  setRuntimeProfile('remembered');invalidateAllProfileCaches();
  vi.spyOn(process.stderr,'write').mockImplementation((...args) => {const callback=args.at(-1);if(typeof callback==='function') callback();return true;});
  vi.spyOn(https,'request').mockImplementation((options, callback) => {
    const o=options as https.RequestOptions, path=String(o.path);paths.push(path);
    const req=new EventEmitter() as EventEmitter & {write:()=>void;end:()=>void;destroy:()=>void};
    req.write=()=>{};req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
      const grant=getProfile('remembered')!.cliRecovery!;
      let status=200, body:unknown={value:'original-data'};
      if(path==='/auth/login') body={accessToken:'environment-access',refreshToken:'environment-refresh',expiresIn:900,user:{id:'human',username:'human',role:'user',tenantId:'tenant'}};
      else if(path==='/auth/mfa/iphone/protocol') body={protocolVersion:3,origin:grant.origin,installationId:grant.installationId,cliRecovery:{version:1,enabled:true}};
      else if(path.endsWith('/start')) body={requestId:'11111111-1111-4111-8111-111111111111',claimant:randomBytes(32).toString('base64url'),comparisonNumber:'42',expiresAt:Math.floor(Date.now()/1000)+120};
      else if(path.endsWith('/status')) body={state:pending?'pending':'approved',expiresAt:Math.floor(Date.now()/1000)+120};
      else if(path.endsWith('/complete')) {body={accessToken:'recovered-access',refreshToken:'recovered-refresh',expiresIn:recoveredExpiresIn,userSealedUnlocked:false,user:{id:'human',username:'human',role:'user',tenantId:'tenant'}};replace?.();}
      else if(path==='/auth/refresh') {status=refreshStatus;body=refreshStatus===200?{accessToken:'renewed-access',refreshToken:'renewed-refresh',expiresIn:900}:{error:'rejected',code:'FIXTURE_AUTH',message:refreshMessage};}
      else if(path.startsWith('/v1/')) {status=outcome;body=outcome===200?body:{error:'rejected'};}
      if(path.endsWith('/start') && recoveryStatus!==200) {status=recoveryStatus;body={error:'rate_limited',code:'FIXTURE_RECOVERY',message:'Try later'};}
      const res=Object.assign(new EventEmitter(),{statusCode:status,headers:status===429?{'retry-after':'47'}:{}});
      (callback as (res:unknown)=>void)(res);res.emit('data',JSON.stringify(body));res.emit('end');
    });return req as unknown as ReturnType<typeof https.request>;
  });
});
afterEach(()=>{httpModule.configureAutomaticRecovery?.(null);vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();setRuntimeProfile(null);invalidateAllProfileCaches();});
function credentials(expired=false,marked=false) {
  const p=getProfile('remembered')!;p.credentials={accessToken:'old-access',refreshToken:'old-refresh',expiresAt:expired?1:Date.now()+900000,userId:'human',username:'human',role:'user',tenantId:'tenant',...(marked?{pendingRefresh:{presentedJti:'old',startedAt:1}}:{})};
  store.set('profiles',{remembered:p});invalidateAllProfileCaches();
}
describe('ordinary HTTP automatic iPhone recovery',()=>{
  it('recovers missing auth before sending an unsent write, leaving stdout pristine in nonTTY',async()=>{
    configure();const stdout=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
    expect(await new httpModule.HttpClient().post('/v1/fixture',{value:1})).toEqual({value:'original-data'});
    expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths.filter(x=>x==='/v1/fixture')).toHaveLength(1);
    expect(stdout).not.toHaveBeenCalled();expect(vi.mocked(process.stderr.write).mock.calls.map(x=>String(x[0])).join('')).toContain('42');
  });
  it('uses a newly recovered short-lived token once instead of immediately refreshing it',async()=>{
    configure();recoveredExpiresIn=60;
    expect(await new httpModule.HttpClient().get('/v1/fixture')).toEqual({value:'original-data'});
    expect(paths).not.toContain('/auth/refresh');expect(paths.filter(x=>x==='/v1/fixture')).toHaveLength(1);
  });
  it('uses valid tokens and successful ordinary refresh without a push',async()=>{
    configure();credentials();await new httpModule.HttpClient().get('/v1/fixture');expect(paths).toEqual(['/v1/fixture']);
    paths=[];credentials(true);refreshStatus=200;await new httpModule.HttpClient().get('/v1/fixture');expect(paths).toEqual(['/auth/refresh','/v1/fixture']);
  });
  it('never sends a third read when normal-refresh replay is also rejected',async()=>{
    configure();credentials();refreshStatus=200;outcome=401;
    await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toThrow(/not reissued/);
    expect(paths.filter(x=>x==='/v1/fixture')).toHaveLength(2);expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);
  });
  it('never pushes while the marked refresh still has a live owner',async()=>{
    configure();credentials(true,true);
    const {acquireRefreshLock,computeLockKey}=await import('../../src/lib/client/refresh-lock.js');
    const lock=await acquireRefreshLock(computeLockKey('old-refresh','remembered'),{timeoutMs:0});expect(lock).not.toBeNull();
    try {await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toThrow(/owned|process/);expect(paths).toEqual([]);expect(getProfile('remembered')?.credentials?.pendingRefresh).toBeDefined();}
    finally {await lock?.release();}
  });
  it.each(['api-key','environment','local','auth-control'])('does not auto recover %s requests',async mode=>{
    configure();
    if(mode==='api-key') {const p=getProfile('remembered')!;p.apiKey='znv_'+ 'b'.repeat(64);store.set('profiles',{remembered:p});invalidateAllProfileCaches();}
    if(mode==='environment') vi.stubEnv('ZNVAULT_USERNAME','human');
    if(mode==='local') vi.stubEnv('ZNVAULT_LOCAL','1');
    const path=mode==='auth-control'?'/auth/control':'/v1/fixture';
    await new httpModule.HttpClient().get(path);expect(paths).toEqual([path]);
  });
  it('preserves ordinary environment login when automatic policy is configured',async()=>{
    const profile=getProfile('remembered')!;delete profile.cliRecovery;store.set('profiles',{remembered:profile});invalidateAllProfileCaches();
    vi.stubEnv('ZNVAULT_USERNAME','human');vi.stubEnv('ZNVAULT_PASSWORD','synthetic-password');configure();
    expect(await new httpModule.HttpClient().get('/v1/fixture')).toEqual({value:'original-data'});
    expect(paths).toEqual(['/auth/login','/v1/fixture']);expect(getProfile('remembered')?.credentials?.accessToken).toBe('environment-access');
  });
  it('shares one recovery across separate domain clients',async()=>{
    configure();await Promise.all([new httpModule.HttpClient().get('/v1/one'),new httpModule.HttpClient().get('/v1/two')]);
    expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths.filter(x=>x.startsWith('/v1/'))).toHaveLength(2);
  });
  it.each([403,423,429,500])('does not recover a refresh HTTP %s and preserves its code',async status=>{
    credentials(true);refreshStatus=status;configure();
    await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toMatchObject({statusCode:status,errorCode:'FIXTURE_AUTH'});
    expect(paths).toEqual(['/auth/refresh']);
  });
  it('does not classify a server failure as refresh contention from its message',async()=>{
    credentials(true);refreshStatus=500;refreshMessage='refresh_in_progress';configure();
    await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toMatchObject({name:'Error',statusCode:500,errorCode:'FIXTURE_AUTH'});
    expect(paths).toEqual(['/auth/refresh']);
  });
  it('preserves a recovery rate limit and Retry-After without another push',async()=>{
    configure();recoveryStatus=429;
    await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toMatchObject({statusCode:429,errorCode:'FIXTURE_RECOVERY',retryAfterSeconds:47});
    expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths.filter(x=>x.startsWith('/v1/'))).toHaveLength(0);
  });
  it('recovers a terminal refresh 401 without presenting its marked refresh again',async()=>{
    credentials(true);configure();await new httpModule.HttpClient().get('/v1/fixture');
    expect(paths.filter(x=>x==='/auth/refresh')).toHaveLength(1);expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);
  });
  it('recovers an orphaned marker without presenting it',async()=>{
    credentials(true,true);configure();await new httpModule.HttpClient().get('/v1/fixture');expect(paths).not.toContain('/auth/refresh');
  });
  it('recovers the session but never reissues an already sent write',async()=>{
    credentials();outcome=401;configure();
    await expect(new httpModule.HttpClient().post('/v1/fixture',{value:1})).rejects.toThrow(/not reissued/i);
    expect(paths.filter(x=>x==='/v1/fixture')).toHaveLength(1);expect(getProfile('remembered')?.credentials?.accessToken).toBe('recovered-access');
  });
  it('limits an always-401 read to one recovery and one continuation',async()=>{
    credentials();outcome=401;configure();await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toMatchObject({statusCode:401});
    expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths.filter(x=>x==='/v1/fixture')).toHaveLength(2);
  });
  it.each(['skipAuth','skipAuthRefresh','sessionGuard'])('does not recover internal or caller-guarded %s requests',async flag=>{
    configure();outcome=401;await expect(new httpModule.HttpClient().request({method:'POST',path:'/v1/fixture',[flag]:flag==='sessionGuard'?()=>{}:true})).rejects.toMatchObject({statusCode:401});
    expect(paths).toEqual(['/v1/fixture']);
  });
  it('does not adopt another recovery generation during deferred coordinator loading',async()=>{
    configure();const operation=new httpModule.HttpClient().get('/v1/fixture');
    queueMicrotask(()=>{const p=getProfile('remembered')!;store.set('profiles',{remembered:{...p,authGeneration:randomUUID(),cliRecovery:{...p.cliRecovery!,grantId:randomUUID()}}});invalidateAllProfileCaches();});
    await expect(operation).rejects.toThrow(/changed/);expect(paths).toEqual([]);
  });
  it('refuses late tokens after unrelated authentication replacement',async()=>{
    configure();replace=()=>{const p=getProfile('remembered')!;store.set('profiles',{remembered:{...p,authGeneration:randomUUID()}});invalidateAllProfileCaches();};
    await expect(new httpModule.HttpClient().get('/v1/fixture')).rejects.toThrow();expect(paths.filter(x=>x.startsWith('/v1/'))).toHaveLength(0);
  });
  it('cancels pending approval without late tokens or signal-listener leaks',async()=>{
    const controller=new AbortController(), before=[process.listenerCount('SIGINT'),process.listenerCount('SIGTERM')];
    pending=true;configure();
    vi.mocked(process.stderr.write).mockImplementation((...args)=>{const callback=args.at(-1);if(typeof callback==='function') callback();controller.abort();return true;});
    await expect(new httpModule.HttpClient().request({method:'GET',path:'/v1/fixture',signal:controller.signal})).rejects.toThrow();
    // Let the owner finish cancellation and release its lock.
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(paths.filter(x=>x.endsWith('/start'))).toHaveLength(1);expect(paths).not.toContain('/auth/cli/recovery/complete');
    expect(getProfile('remembered')?.credentials).toBeUndefined();
    expect([process.listenerCount('SIGINT'),process.listenerCount('SIGTERM')]).toEqual(before);
  });
  it('bounds a pending phone attempt by one 120 second deadline',async()=>{
    vi.useFakeTimers();
    let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    configure(async(_peer,signal)=>{started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return {success:false,error:'cancelled'};});
    const operation=new httpModule.HttpClient().get('/v1/fixture');void operation.catch(()=>{});
    await ready;await vi.advanceTimersByTimeAsync(120000);
    await expect(operation).rejects.toThrow(/expired|cancelled/);expect(paths).toEqual([]);
    vi.useRealTimers();
  });
  it('does not start recovery after caller cancellation',async()=>{
    configure();await expect(new httpModule.HttpClient().request({method:'GET',path:'/v1/fixture',signal:AbortSignal.abort()})).rejects.toThrow();expect(paths).toEqual([]);
  });
});
