import {HttpClient} from '../client/http.js';
import {authenticationFingerprint,getProfile,profileExists} from '../config/profile.js';
import {computeKeyFingerprint,parseExpectedSelection,type ExpectedSelection,type KeyProvider,type KeyReference} from '../../vendor/archon-recovery-core/index.js';
import {decodeMasterKeyBytes} from '../../vendor/archon-recovery-core/arcn-envelope.js';

export interface RecoveryRequest {selection:ExpectedSelection;requestId:string;signal:AbortSignal}
export type VaultKeyProvider = KeyProvider & {dispose():void};
/** Snapshot only this existing named profile, never runtime/active/env defaults.
 * Explicit native login remains the prerequisite; recovery never refreshes or
 * rewrites credentials. Server authorization remains authoritative. */
export function createRecoveryClient(profileName:string,tlsSpkiSha256?:string):HttpClient {
 if(!profileExists(profileName))throw Error('recovery_profile_unknown');
 const stored=getProfile(profileName);if(!stored)throw Error('recovery_profile_unknown');
 const profile=structuredClone(stored);
 const origin=new URL(profile.url);
 if(profile.insecure||origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('recovery_verified_tls_required');
 const fingerprint=authenticationFingerprint(profile);
 const assertCurrent=():void=>{
  if(!profileExists(profileName)||authenticationFingerprint(getProfile(profileName))!==fingerprint)throw Error('recovery_profile_changed');
  if(!profile.apiKey&&(!profile.credentials?.accessToken||profile.credentials.expiresAt<=Date.now()||profile.credentials.pendingRefresh))throw Error('recovery_native_login_required');
 };
 assertCurrent();
 return new HttpClient({baseUrl:origin.origin,insecure:false,timeout:profile.timeout,...(tlsSpkiSha256?{tlsSpkiSha256}:{}),invocationContext:{authorization:Object.freeze(profile.apiKey?{apiKey:profile.apiKey}:{accessToken:profile.credentials?.accessToken}),assertCurrent}});
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/;
function canonical(key:KeyReference):string {return key.kind==='vault-backup-key-v1'?JSON.stringify([key.kind,key.algorithm,key.fingerprint,key.familyId,key.keyVersion,key.materialId,key.sourceInstallationId,key.sourceSecretId,key.sourceDataVersion]):JSON.stringify([key.kind,key.algorithm,key.fingerprint,key.nativeBinding?.sourceInstallationId,key.nativeBinding?.sourceSecretId,key.nativeBinding?.sourceDataVersion]);}
function validateBinding(requested:KeyReference,source:KeyReference):boolean {
 if(requested.kind==='archon-kek-fingerprint-v1'&&!requested.nativeBinding)return source.kind===requested.kind&&source.fingerprint===requested.fingerprint&&!!source.nativeBinding;
 return canonical(requested)===canonical(source);
}
/** Only native file-shaped data or one exact field; never try field/key variants. */
function decodeValue(data:unknown):Buffer {
 if(data===null||typeof data!=='object'||Array.isArray(data))throw Error('recovery_key_format');
 const object=data as Record<string,unknown>,fields=Object.keys(object),field=fields[0];let input:Buffer;
 if(typeof object.filename==='string'&&typeof object.content==='string'){
  if(object.content.length>88)throw Error('recovery_key_format');input=Buffer.from(object.content,'base64');
  if(input.toString('base64')!==object.content){input.fill(0);throw Error('recovery_key_format');}
 }else if(fields.length===1&&typeof object[field]==='string'&&/^[a-fA-F0-9]{64}\n?$/.test(object[field]))input=Buffer.from(object[field],'ascii');
 else throw Error('recovery_key_format');
 try{return decodeMasterKeyBytes(input);}finally{input.fill(0);}
}
export function createVaultKeyProvider(profileName:string,request:RecoveryRequest,client=createRecoveryClient(profileName)):VaultKeyProvider {
 const selection=parseExpectedSelection(Buffer.from(JSON.stringify(request.selection)));
 const buffers=new Set<Buffer>();let disposed=false;
 const dispose=():void=>{disposed=true;for(const b of buffers)b.fill(0);buffers.clear();request.signal.removeEventListener('abort',dispose);};
 request.signal.addEventListener('abort',dispose,{once:true});
 const provider:VaultKeyProvider=Object.assign(async(key:KeyReference,signal:AbortSignal):Promise<Buffer>=>{
  let decoded:Buffer|undefined;
  const combined=AbortSignal.any([signal,request.signal]);
  try{
   combined.throwIfAborted();if(disposed||!selection.keyBindings.some(b=>canonical(b.key)===canonical(key)))throw Error('recovery_key_not_selected');
   const binding=await client.request<{secretId:string;dataVersion:number;sourceIdentity:KeyReference;fingerprint:string}>({method:'POST',path:key.kind==='vault-backup-key-v1'?`/v1/backup-recovery/materials/${key.materialId}/resolve`:'/v1/backup-recovery/materials/resolve',body:{key},signal:combined});
   // Validate the returned descriptor with the maintained parser as well as equality.
   const checked=parseExpectedSelection(Buffer.from(JSON.stringify({...selection,keyBindings:[{fingerprint:binding.fingerprint,key:binding.sourceIdentity}]}))).keyBindings[0].key;
   if(!uuid.test(binding.secretId)||!Number.isSafeInteger(binding.dataVersion)||binding.dataVersion<1||binding.fingerprint!==key.fingerprint||!validateBinding(key,checked))throw Error('recovery_binding_mismatch');
   const meta=await client.request<{version:number;referencesEnabled?:boolean;hasReferences?:boolean;subType?:string}>({method:'GET',path:`/v1/secrets/${binding.secretId}/meta`,signal:combined});
   if(!Number.isSafeInteger(meta.version)||meta.version<binding.dataVersion||meta.referencesEnabled||meta.hasReferences||meta.subType==='link')throw Error('recovery_binding_invalid');
   const path=meta.version===binding.dataVersion?`/v1/secrets/${binding.secretId}/decrypt?resolve=false`:`/v1/secrets/${binding.secretId}/history/${binding.dataVersion}/decrypt`;
   const value=await client.request<{id:string;version:number;data:unknown}>({method:'POST',path:path.split('?')[0],...(path.includes('?')?{query:{resolve:false}}:{}),body:{},signal:combined});
   if(value.id!==binding.secretId||value.version!==binding.dataVersion)throw Error('recovery_native_version_mismatch');
   decoded=decodeValue(value.data);value.data=undefined;
   combined.throwIfAborted();if(computeKeyFingerprint(decoded)!==key.fingerprint)throw Error('recovery_key_mismatch');
   buffers.add(decoded);return decoded;
  }catch{decoded?.fill(0);dispose();throw Error('recovery_native_key_unavailable');}
 },{dispose});
 return provider;
}
