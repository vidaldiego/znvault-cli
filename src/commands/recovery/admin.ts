import {createRecoveryClient} from '../../lib/recovery/vault-key-provider.js';
export async function runRecoveryAdmin(command:'keys'|'status',options:{id?:string;after?:string},profile:{profile:string;tlsSpkiSha256?:string}):Promise<void>{
 for(const id of [options.id,options.after])if(id&&!/^[a-f0-9-]{36}$/.test(id))throw Error('recovery_metadata_id_invalid');
 if(options.id&&options.after)throw Error('recovery_options_incompatible');
 const client=createRecoveryClient(profile.profile,profile.tlsSpkiSha256);
 const path=command==='keys'?'materials':'records';
 const result=await client.request<unknown>({method:'GET',path:`/v1/backup-recovery/${path}${options.id?`/${options.id}${command==='status'?'/detail':''}`:''}`,...(options.after?{query:{after:options.after}}:{})});
 console.log(JSON.stringify(result));
}
