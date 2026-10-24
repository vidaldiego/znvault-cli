import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import {linkingOperation,resolveLink,resolveSelection,type LinkOutputOptions} from '../../lib/linking.js';
import {resolveSecretId} from './resolve.js';

interface Options extends LinkOutputOptions {link:string;alias?:string;selection?:string}
export function registerReplicationCommands(parent:Command):void {
  const replication=parent.command('replication').description('Explicit per-secret copies; values remain editable only at origin');
  for(const action of ['enable','status','sync','stop','resume'] as const)replication.command(`${action} <id-or-alias>`)
    .requiredOption('--link <name-or-id>','Exact source link name or binding UUID')
    .option('--selection <id>', 'Disambiguate a retained or current selection UUID')
    .option('--alias <alias>','Immutable destination alias (enable only)').option('--json','Redacted metadata')
    .action(async(secret:string,options:Options)=>{
      await linkingOperation(async()=>{
        if(action==='enable'){
          if(!options.alias)throw new Error('LINKING_DESTINATION_ALIAS_REQUIRED');
          const secretId=await resolveSecretId(secret),{binding}=await resolveLink(options.link);
          return await client.post(`/v1/secrets/${encodeURIComponent(secretId)}/replication`,{bindingId:binding.id,destinationAlias:options.alias});
        }
        if(action==='status'){
          const secretId=await resolveSecretId(secret),{status,binding}=await resolveLink(options.link,false);
          return {bindings:[binding],selections:status.selections.filter(s=>s.binding_id===binding.id&&s.source_secret_id===secretId&&(!options.selection||s.id===options.selection)),replicas:status.replicas?.filter(r=>r.binding_id===binding.id&&r.id===secretId) ?? []};
        }
        const {secretId,selection}=await resolveSelection(secret,options.link,options.selection);
        return await client.post(`/v1/secrets/${encodeURIComponent(secretId)}/replication/${encodeURIComponent(selection.id)}/${action}`,{});
      },options,action==='sync'?'Sync queued; remote receipt pending':action==='status'?'Replication metadata':`${action} accepted; remote state may remain pending`);
    });
}
