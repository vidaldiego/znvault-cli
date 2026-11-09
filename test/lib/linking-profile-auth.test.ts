import https from 'node:https';
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {store,setRuntimeProfile,invalidateAllProfileCaches} from '../../src/lib/config.js';
import {consentProfiles,withLinkProfile} from '../../src/lib/linking.js';
import * as prompts from '../../src/lib/prompts.js';

const sent:Array<{hostname:unknown;headers:Record<string,string>;rejectUnauthorized?:boolean}> = [];
const profiles=()=>Object.fromEntries(['source','destination'].map(name=>[name,{url:`https://${name}.example.com`,insecure:false,timeout:1000,
  credentials:{accessToken:`${name}-jwt`,refreshToken:`${name}-refresh`,expiresAt:Date.now()+3600000,user:{id:name,username:name,role:'user',tenantId:name}}}]));
beforeEach(()=>{
  sent.length=0;
  store.set('profiles',profiles());setRuntimeProfile('source');invalidateAllProfileCaches();
  for(const name of ['ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD'])vi.stubEnv(name,undefined);
  vi.spyOn(prompts,'promptPassword').mockResolvedValueOnce('receiver-secret').mockResolvedValueOnce('export-secret');
  // Real VaultClient/HttpClient/config auth selection; only HTTPS bytes are simulated.
  vi.spyOn(https,'request').mockImplementation((options,callback)=>{
    const opts=options as https.RequestOptions;sent.push({hostname:opts.hostname,headers:opts.headers as Record<string,string>,rejectUnauthorized:opts.rejectUnauthorized});
    const req=new EventEmitter() as EventEmitter & {write:()=>void;end:()=>void;destroy:()=>void};
    req.write=()=>{};req.destroy=()=>{};req.end=()=>{
      const response=new EventEmitter() as EventEmitter & {statusCode:number;headers:object};response.statusCode=200;response.headers={};
      (callback as (response:unknown)=>void)(response);response.emit('data',Buffer.from('{"consented":true}'));response.emit('end');
    };
    return req as unknown as ReturnType<typeof https.request>;
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();setRuntimeProfile(null);invalidateAllProfileCaches();});
describe('two-profile linking uses profile JWTs, never ambient auth',()=>{
  it('sends destination/source JWT to the corresponding fixed HTTPS recipient',async()=>{
    await consentProfiles({sourceProfile:'source',destinationProfile:'destination',sourceBinding:'source-binding',destinationBinding:'destination-binding'});
    expect(sent.map(r=>[r.hostname,r.headers.Authorization,r.headers['X-API-Key']])).toEqual([
      ['destination.example.com','Bearer destination-jwt',undefined],['source.example.com','Bearer source-jwt',undefined],
    ]);
  });
  it.each(['ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD'])('refuses %s before reading keys or sending any bytes',async name=>{
    vi.stubEnv(name,'ambient-sensitive-value');
    await expect(consentProfiles({sourceProfile:'source',destinationProfile:'destination',sourceBinding:'source-binding',destinationBinding:'destination-binding'})).rejects.toThrow('LINKING_AMBIENT_AUTH_FORBIDDEN');
    expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
    expect(process.env[name]).toBe('ambient-sensitive-value');
  });
  it('rejects a profile with an API key rather than a JWT, without requests',async()=>{
    const values=profiles();values.destination={...values.destination,apiKey:'profile-key'};
    store.set('profiles',values);invalidateAllProfileCaches();
    await expect(withLinkProfile('destination',async peer=>await peer.get('/v1/linking'))).rejects.toThrow('LINKING_PROFILE_SESSION_REQUIRED');
    expect(sent).toEqual([]);
  });
  it('validates the second profile session before prompting or transmitting',async()=>{
    const values=profiles();delete values.destination.credentials;
    store.set('profiles',values);invalidateAllProfileCaches();
    await expect(consentProfiles({sourceProfile:'source',destinationProfile:'destination',sourceBinding:'s',destinationBinding:'d'})).rejects.toThrow('LINKING_PROFILE_SESSION_REQUIRED');
    expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
  });
  it('keeps named origin and verified TLS despite ordinary global connection overrides',async()=>{
    vi.stubEnv('ZNVAULT_URL','https://wrong.example.com');vi.stubEnv('ZNVAULT_INSECURE','true');
    await withLinkProfile('destination',async peer=>await peer.get('/v1/linking'));
    expect(sent).toMatchObject([{hostname:'destination.example.com',rejectUnauthorized:true,headers:{Authorization:'Bearer destination-jwt'}}]);
  });
});

describe('KMS consent profile isolation',()=>{
  const pin='MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const options={sourceProfile:'source',destinationProfile:'destination',sourceBinding:'source-binding',destinationBinding:'destination-binding',sourceSignerPin:pin,destinationSignerPin:pin,destinationRecipientPin:pin};
  it('uses both verified profile JWT channels and only one protected receiving input',async()=>{
    const {consentKmsProfiles}=await import('../../src/lib/linking-kms.js');
    await consentKmsProfiles(options);
    expect(sent.map(r=>[r.hostname,r.headers.Authorization,r.headers['X-API-Key'],r.rejectUnauthorized])).toEqual([['destination.example.com','Bearer destination-jwt',undefined,true],['source.example.com','Bearer source-jwt',undefined,true]]);
    expect(prompts.promptPassword).toHaveBeenCalledTimes(1);
  });
  it.each(['ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD','ZNVAULT_INSECURE','ZNVAULT_URL'])('refuses ambient override %s before protected input or transport',async name=>{
    const {consentKmsProfiles}=await import('../../src/lib/linking-kms.js');
    vi.stubEnv(name,name==='ZNVAULT_INSECURE'?'true':'ambient-sensitive-value');
    await expect(consentKmsProfiles(options)).rejects.toThrow(/^LINKING_/);
    expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
  });
  it('checks destination TLS before reading the receiver input',async()=>{
    const {consentKmsProfiles}=await import('../../src/lib/linking-kms.js');
    const values=profiles();values.destination.insecure=true;store.set('profiles',values);invalidateAllProfileCaches();
    await expect(consentKmsProfiles(options)).rejects.toThrow('LINKING_SECURE_PROFILE_REQUIRED');expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
  });
  it('refuses API-key profiles before reading any credentials',async()=>{
    const {consentKmsProfiles}=await import('../../src/lib/linking-kms.js');
    const values=profiles();values.destination={...values.destination,apiKey:'profile-key'};store.set('profiles',values);invalidateAllProfileCaches();
    await expect(consentKmsProfiles(options)).rejects.toThrow('LINKING_PROFILE_SESSION_REQUIRED');expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
  });
  it('rejects an exporter input rather than reading or using it for KMS',async()=>{
    const {consentKmsProfiles}=await import('../../src/lib/linking-kms.js');
    await expect(consentKmsProfiles({...options,exportKeyFile:'/unread/exporter'})).rejects.toThrow('LINKING_KMS_EXPORTER_FORBIDDEN');expect(sent).toEqual([]);expect(prompts.promptPassword).not.toHaveBeenCalled();
  });
});
