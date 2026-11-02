import {randomUUID} from 'node:crypto';
import {createRecoveryClient,createVaultKeyProvider} from '../../lib/recovery/vault-key-provider.js';
import {parseExpectedSelection} from '../../vendor/archon-recovery-core/index.js';
import {loadTrustedSelection,runRecoveryOperation,type LocalRecoveryOptions} from './local.js';
export async function runAssistedRecovery(mode:'verify'|'extract',options:LocalRecoveryOptions & {backup?:string},profile:{profile:string;tlsSpkiSha256?:string}):Promise<void>{
 const client=createRecoveryClient(profile.profile,profile.tlsSpkiSha256);
 let expected;
 if(options.backup){
  if(!/^[a-f0-9-]{36}$/.test(options.backup))throw Error('recovery_selection_id_invalid');
  const record=await client.request<{id:string;expected:unknown;provenance:{metadataSha256:string};revision:number}>({method:'GET',path:`/v1/backup-recovery/records/${options.backup}`});
  expected=parseExpectedSelection(Buffer.from(JSON.stringify(record.expected)));
  if(record.id!==options.backup||record.provenance.metadataSha256!==expected.metadata.sha256||!Number.isSafeInteger(record.revision)||record.revision<1)throw Error('recovery_selection_invalid');
 }else expected=await loadTrustedSelection(options.expect);
 await runRecoveryOperation(mode,options,{expected,keys:signal=>{const provider=createVaultKeyProvider(profile.profile,{selection:expected,requestId:randomUUID(),signal},client);return {get:provider,dispose:()=>{provider.dispose();}};}});
}
