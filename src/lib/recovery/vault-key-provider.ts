import {RecoveryPrerequisiteError} from './prerequisites.js';
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
 if(!profileExists(profileName))throw new RecoveryPrerequisiteError('recovery_profile_unknown');
 const stored=getProfile(profileName);if(!stored)throw new RecoveryPrerequisiteError('recovery_profile_unknown');
 const profile=structuredClone(stored);
 let origin: URL;
 try {origin=new URL(profile.url);} catch {throw new RecoveryPrerequisiteError('recovery_verified_tls_required');}
 if(tlsSpkiSha256!==undefined&&!/^[a-f0-9]{64}$/.test(tlsSpkiSha256))throw new RecoveryPrerequisiteError('recovery_verified_tls_required');
 if(profile.insecure||origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new RecoveryPrerequisiteError('recovery_verified_tls_required');
 const fingerprint=authenticationFingerprint(profile);
 const assertCurrent=():void=>{
  if(!profileExists(profileName)||authenticationFingerprint(getProfile(profileName))!==fingerprint)throw Error('recovery_profile_changed');
  if(!profile.apiKey&&(!profile.credentials?.accessToken||profile.credentials.expiresAt<=Date.now()||profile.credentials.pendingRefresh))throw new RecoveryPrerequisiteError('recovery_native_login_required');
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
interface NativeKeyMetadata {
 version:number;type?:string;subType?:string;sub_type?:string;
 referencesEnabled?:boolean;hasReferences?:boolean;references_enabled?:unknown;has_references?:unknown;
}
interface NativeKeyValue {
 id:string;version:number;type?:string;subType?:string;sub_type?:string;
 resolved?:unknown;resolvedFrom?:unknown;data:unknown;
}
/** Closed native credential, file or single-field formats; never try key variants. */
function decodeValue(data:unknown,meta:NativeKeyMetadata,value:NativeKeyValue):Buffer {
 if(data===null||typeof data!=='object'||Array.isArray(data))throw Error('recovery_key_format');
 const object=data as Record<string,unknown>,fields=Object.keys(object),field=fields[0];let input:Buffer;
 if(Object.hasOwn(object,'password')||Object.hasOwn(object,'username')){
  if(Object.getPrototypeOf(object)!==Object.prototype||meta.type!=='credential'||meta.subType!=='password'||
   meta.referencesEnabled!==false||meta.hasReferences!==false||
   (meta.sub_type!==undefined&&meta.sub_type!=='password')||
   (meta.references_enabled!==undefined&&meta.references_enabled!==false)||(meta.has_references!==undefined&&meta.has_references!==false)||
   value.type!=='credential'||(value.subType!==undefined&&value.subType!=='password')||(value.sub_type!==undefined&&value.sub_type!=='password')||
   Object.hasOwn(value,'resolved')||Object.hasOwn(value,'resolvedFrom')||
   !Object.hasOwn(object,'password')||!fields.every(name=>name==='password'||name==='username')||
   typeof object.password!=='string'||!/^[a-fA-F0-9]{64}\n?$/.test(object.password)||
   (Object.hasOwn(object,'username')&&(typeof object.username!=='string'||object.username.length>256)))throw Error('recovery_key_format');
  input=Buffer.from(object.password,'ascii');
 }else if(typeof object.filename==='string'&&typeof object.content==='string'){
  if(object.content.length>88)throw Error('recovery_key_format');input=Buffer.from(object.content,'base64');
  if(input.toString('base64')!==object.content){input.fill(0);throw Error('recovery_key_format');}
 }else if(fields.length===1&&typeof object[field]==='string'&&/^[a-fA-F0-9]{64}\n?$/.test(object[field]))input=Buffer.from(object[field],'ascii');
 else throw Error('recovery_key_format');
 try{return decodeMasterKeyBytes(input);}finally{input.fill(0);}
}
export function createVaultKeyProvider(profileName:string,request:RecoveryRequest,client=createRecoveryClient(profileName)):VaultKeyProvider {
 if(!/^[A-Za-z0-9-]{1,128}$/.test(request.requestId))throw Error('recovery_request_id_invalid');
 const headers={'X-Request-ID':request.requestId};
 const selection=parseExpectedSelection(Buffer.from(JSON.stringify(request.selection)));
 const buffers=new Set<Buffer>();let disposed=false;
 const dispose=():void=>{disposed=true;for(const b of buffers)b.fill(0);buffers.clear();request.signal.removeEventListener('abort',dispose);};
 request.signal.addEventListener('abort',dispose,{once:true});
 const provider:VaultKeyProvider=Object.assign(async(key:KeyReference,signal:AbortSignal):Promise<Buffer>=>{
  let decoded:Buffer|undefined,value:NativeKeyValue|undefined;
  const combined=AbortSignal.any([signal,request.signal]);
  try{
   combined.throwIfAborted();if(disposed||!selection.keyBindings.some(b=>canonical(b.key)===canonical(key)))throw Error('recovery_key_not_selected');
   const binding=await client.request<{secretId:string;dataVersion:number;sourceIdentity:KeyReference;fingerprint:string}>({method:'POST',path:key.kind==='vault-backup-key-v1'?`/v1/backup-recovery/materials/${key.materialId}/resolve`:'/v1/backup-recovery/materials/resolve',body:{key},signal:combined,headers});
   // Validate the returned descriptor with the maintained parser as well as equality.
   const checked=parseExpectedSelection(Buffer.from(JSON.stringify({...selection,keyBindings:[{fingerprint:binding.fingerprint,key:binding.sourceIdentity}]}))).keyBindings[0].key;
   if(!uuid.test(binding.secretId)||!Number.isSafeInteger(binding.dataVersion)||binding.dataVersion<1||binding.fingerprint!==key.fingerprint||!validateBinding(key,checked))throw Error('recovery_binding_mismatch');
   const meta=await client.request<NativeKeyMetadata>({method:'GET',path:`/v1/secrets/${binding.secretId}/meta`,signal:combined,headers});
   if(!Number.isSafeInteger(meta.version)||meta.version<binding.dataVersion||meta.referencesEnabled||meta.hasReferences||meta.subType==='link')throw Error('recovery_binding_invalid');
   const path=meta.version===binding.dataVersion?`/v1/secrets/${binding.secretId}/decrypt?resolve=false`:`/v1/secrets/${binding.secretId}/history/${binding.dataVersion}/decrypt`;
   value=await client.request<NativeKeyValue>({method:'POST',path:path.split('?')[0],...(path.includes('?')?{query:{resolve:false}}:{}),body:{},signal:combined,headers});
   if(value.id!==binding.secretId||value.version!==binding.dataVersion)throw Error('recovery_native_version_mismatch');
   decoded=decodeValue(value.data,meta,value);
   combined.throwIfAborted();if(computeKeyFingerprint(decoded)!==key.fingerprint)throw Error('recovery_key_mismatch');
   buffers.add(decoded);return decoded;
  }catch{decoded?.fill(0);dispose();throw Error('recovery_native_key_unavailable');}
  finally{if(value&&typeof value==='object')value.data=undefined;}
 },{dispose});
 return provider;
}
