import {client} from './client.js';
import {protectedLinkKey,profileOrigin,withLinkProfile,type ConsentOptions} from './linking.js';

export function requireLinkUuid(value:string):string {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error('LINKING_INVALID_REQUEST');
  return value;
}
export interface KmsConsentOptions extends ConsentOptions {kms?:boolean;sourceSignerPin?:string;destinationSignerPin?:string;destinationRecipientPin?:string}
/** Pins come from explicit operator input, never from an incoming transport package. */
export async function consentKmsProfiles(options:KmsConsentOptions):Promise<unknown> {
  if(options.exportKeyFile!==undefined)throw new Error('LINKING_KMS_EXPORTER_FORBIDDEN');
  const pins={sourceSigner:options.sourceSignerPin,destinationSigner:options.destinationSignerPin,destinationRecipient:options.destinationRecipientPin};
  if(Object.values(pins).some(pin=>typeof pin!=='string'||pin.length!==60||!/^[A-Za-z0-9+/]+=$/.test(pin)))throw new Error('LINKING_KMS_PINS_REQUIRED');
  if(process.env.ZNVAULT_INSECURE==='true'||process.env.ZNVAULT_INSECURE==='1'||process.env.ZNVAULT_URL!==undefined)throw new Error('LINKING_SECURE_PROFILE_REQUIRED');
  if(profileOrigin(options.sourceProfile)===profileOrigin(options.destinationProfile))throw new Error('LINKING_DISTINCT_INSTALLATIONS_REQUIRED');
  const receiverKey=await protectedLinkKey(options.receiverKeyFile,'Destination receiving API key (linking:receive only)');
  await withLinkProfile(options.destinationProfile,async peer=>await peer.post(`/v1/linking/bindings/${encodeURIComponent(options.destinationBinding)}/kms/consent`,{peerBindingId:options.sourceBinding,receiverKey,pins}));
  await withLinkProfile(options.sourceProfile,async peer=>await peer.post(`/v1/linking/bindings/${encodeURIComponent(options.sourceBinding)}/kms/consent`,{peerBindingId:options.destinationBinding,receiverKey,pins}));
  return {consented:true,sourceBindingId:options.sourceBinding,destinationBindingId:options.destinationBinding};
}
export async function kmsPost<T>(path:string,body:unknown,requestId?:string):Promise<T> {
  if(requestId===undefined)return await client.post<T>(path,body);
  requireLinkUuid(requestId);
  const [basePath,search]=path.split('?');
  return await client.request<T>({method:'POST',path:basePath,body,...(search?{query:Object.fromEntries(new URLSearchParams(search))}:{}),headers:{'Idempotency-Key':requestId}});
}
export async function kmsSelection(keyId:string,bindingId:string,selectionId?:string):Promise<string> {
  requireLinkUuid(keyId);requireLinkUuid(bindingId);if(selectionId!==undefined)requireLinkUuid(selectionId);
  const result=await client.get<{items:Array<{id:string;bindingId:string}>}>(`/v1/kms/keys/${keyId}/replication`);
  const matches=result.items.filter(item=>item.bindingId===bindingId&&(selectionId===undefined||item.id===selectionId));
  if(matches.length!==1)throw new Error(matches.length?'LINKING_AMBIGUOUS_SELECTION':'LINKING_SELECTION_NOT_FOUND');
  return requireLinkUuid(matches[0].id);
}
