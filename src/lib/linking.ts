import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {client,VaultClient} from './client.js';
import {getActiveProfileName,getProfile,setRuntimeProfile} from './config.js';
import {promptPassword} from './prompts.js';
import * as output from './output.js';
import {resolveSecretId} from '../commands/secret/resolve.js';

export interface LinkBinding {id:string;name:string;direction:string;state:string;connection_id?:string}
export interface LinkSelection {id:string;binding_id:string;source_secret_id:string;lifecycle?:string}
export interface TenantLinks {bindings:LinkBinding[];selections:LinkSelection[];replicas?:Array<{id:string;binding_id:string}>}
export interface Recipient {userId:string;username?:string;keyReady:boolean;keyVersion:number|null;fingerprint:string|null}
export interface LinkOutputOptions {json?:boolean}
const allowed=new Set(`bindingId revokedAt revocation revoke_request_id installationId capability linking sealedLink fleetReady sealedFleetReady schemaReady enabled reason connections bindings selections replicas id name direction state connection_id local_tenant peer_tenant peer_installation_id peer_binding_id generation last_error last_contact_at revocation_unverified selected_count pending_count retained_count error_count source_api_origin destination_origin source_secret_id source_alias destination_alias protection_mode desired_revision acknowledged_revision source_data_version acknowledged_data_version reserved_replica_id enabled paused origin_deleted_at crypto_closed_at last_data_sync_at hasCopy lifecycle syncState recipient_status recipients grantId grant_id userId recipient_user_id username keyReady keyVersion user_key_version fingerprint recipient_fingerprint created_at revoked_at status accessVerification role readonly usableReaderCount sourceVersion copiedVersion sourceExpiresAt sourceTtlUntil grants queued paused remoteConfirmed revocationUnverified revoked consented sourceBindingId destinationBindingId sourceInstallationId destinationInstallationId local_alias local_data_version applied_revision desired_data_version operation requestId`.split(' '));
/** An allowlist, including nested objects: routine JSON cannot print arbitrary response payloads. */
export function sanitiseLinkMetadata(value:unknown):unknown {
  if(Array.isArray(value))return value.map(sanitiseLinkMetadata);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>allowed.has(key)).map(([key,item])=>[key,sanitiseLinkMetadata(item)]));
  return value;
}
export async function linkingOperation(operation:()=>Promise<unknown>,options:LinkOutputOptions,message:string):Promise<void>{
  try{
    const result=sanitiseLinkMetadata(await operation());
    if(options.json)output.json(result);else{output.info(message);output.json(result);}
  }catch(error){
    const candidate=error!==null&&typeof error==='object'&&'code' in error?error.code:error instanceof Error?error.message:'';
    const code=typeof candidate==='string'&&/^(?:LINKING_|USER_SEALED_|SECRET_REQUIRES_)[A-Z_]+$/.test(candidate)?candidate:'LINKING_REQUEST_FAILED';
    output.error(code);process.exitCode=1;
  }
}
export function profileOrigin(name:string):string {
  // The shared HTTP client intentionally supports ambient auth for ordinary commands.
  // A two-profile credential exchange must never inherit those overrides/fallbacks.
  if(['ZNVAULT_API_KEY','ZNVAULT_USERNAME','ZNVAULT_PASSWORD'].some(key=>process.env[key]!==undefined))throw new Error('LINKING_AMBIENT_AUTH_FORBIDDEN');
  const profile=getProfile(name);
  if(!profile||profile.insecure)throw new Error('LINKING_SECURE_PROFILE_REQUIRED');
  if(profile.apiKey||!profile.credentials?.accessToken)throw new Error('LINKING_PROFILE_SESSION_REQUIRED');
  const url=new URL(profile.url);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('LINKING_SECURE_PROFILE_REQUIRED');
  return url.origin;
}
export async function withLinkProfile<T>(name:string,operation:(peer:VaultClient)=>Promise<T>):Promise<T>{
  const origin=profileOrigin(name),previous=getActiveProfileName();
  try{setRuntimeProfile(name);return await operation(new VaultClient({baseUrl:origin,insecure:false}));}
  finally{setRuntimeProfile(previous);}
}
export async function protectedLinkKey(file:string|undefined,label:string):Promise<string>{
  if(!file)return await promptPassword(label);
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>256||(process.getuid&&stat.uid!==process.getuid()))throw new Error('LINKING_PROTECTED_INPUT_REQUIRED');
    const key=(await handle.readFile('utf8')).trim();
    if(!key||key.length>128)throw new Error('LINKING_INVALID_CREDENTIAL_INPUT');
    return key;
  }finally{await handle.close();}
}
export interface ConsentOptions {sourceProfile:string;destinationProfile:string;sourceBinding:string;destinationBinding:string;receiverKeyFile?:string;exportKeyFile?:string}
export async function consentProfiles(options:ConsentOptions):Promise<{consented:true;sourceBindingId:string;destinationBindingId:string}>{
  // Validate BOTH recipients before reading any credential; never use global --url/--insecure overrides.
  if(profileOrigin(options.sourceProfile)===profileOrigin(options.destinationProfile))throw new Error('LINKING_DISTINCT_INSTALLATIONS_REQUIRED');
  const receiverKey=await protectedLinkKey(options.receiverKeyFile,'Destination receiving API key (linking:receive only)');
  const exportKey=await protectedLinkKey(options.exportKeyFile,'Source resource-scoped export API key');
  await withLinkProfile(options.destinationProfile,async peer=>await peer.post(`/v1/linking/bindings/${encodeURIComponent(options.destinationBinding)}/consent`,{peerBindingId:options.sourceBinding,receiverKey}));
  await withLinkProfile(options.sourceProfile,async peer=>await peer.post(`/v1/linking/bindings/${encodeURIComponent(options.sourceBinding)}/consent`,{peerBindingId:options.destinationBinding,receiverKey,exportKey}));
  return {consented:true,sourceBindingId:options.sourceBinding,destinationBindingId:options.destinationBinding};
}
export async function resolveLink(name:string,sourceOnly=true):Promise<{status:TenantLinks;binding:LinkBinding}>{
  const status=await client.get<TenantLinks>('/v1/linking');
  const matches=status.bindings.filter(b=>(!sourceOnly||b.direction==='source')&&(b.id===name||b.name===name));
  if(matches.length!==1)throw new Error(matches.length?'LINKING_AMBIGUOUS_LINK':'LINKING_BINDING_NOT_FOUND');
  return {status,binding:matches[0]};
}
export async function resolveSelection(secret:string,link:string,selectionId?:string):Promise<{secretId:string;selection:LinkSelection}>{
  const secretId=await resolveSecretId(secret),{status,binding}=await resolveLink(link);
  const matches=status.selections.filter(s=>s.binding_id===binding.id&&s.source_secret_id===secretId&&(!selectionId||s.id===selectionId));
  if(matches.length!==1)throw new Error(matches.length?'LINKING_AMBIGUOUS_SELECTION':'LINKING_SELECTION_NOT_FOUND');
  return {secretId,selection:matches[0]};
}
