import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import {linkingOperation,type LinkOutputOptions} from '../../lib/linking.js';
import {kmsSelection,requireLinkUuid} from '../../lib/linking-kms.js';
interface Options extends LinkOutputOptions {link?:string;selection?:string}
/** Tenant-only explicit per-key selection. Every invocation is finite; no status polling. */
export function registerKmsReplicationCommands(parent:Command):void {
  const replication=parent.command('replication').description('Select a KMS key for replication; grants remain local');
  replication.command('enable <keyId>').requiredOption('--link <bindingUUID>','Exact destination binding UUID').option('--json','Public metadata only')
    .action(async(keyId:string,options:Options)=>{await linkingOperation(async()=>{
      requireLinkUuid(keyId);const bindingId=requireLinkUuid(options.link??'');
      return await client.post(`/v1/kms/keys/${keyId}/replication`,{bindingId});
    },options,'Key selected; remote receipt pending');});
  replication.command('status <keyId>').option('--link <bindingUUID>','Filter to one binding').option('--json','Public metadata only')
    .action(async(keyId:string,options:Options)=>{await linkingOperation(async()=>{
      requireLinkUuid(keyId);if(options.link)requireLinkUuid(options.link);
      const response=await client.get<{items:Array<{bindingId:string}>}>(`/v1/kms/keys/${keyId}/replication`);
      return options.link?{items:response.items.filter(item=>item.bindingId===options.link)}:response;
    },options,'Replication selection status');});
  for(const action of ['sync','stop','resume'] as const)replication.command(`${action} <keyId>`)
    .requiredOption('--link <bindingUUID>','Exact binding UUID').option('--selection <uuid>','Disambiguate retained selections').option('--json','Public metadata only')
    .action(async(keyId:string,options:Options)=>{await linkingOperation(async()=>{
      const id=await kmsSelection(keyId,options.link??'',options.selection);
      return await client.post(`/v1/kms/keys/${keyId}/replication/${id}/${action}`,{});
    },options,action==='stop'?'Replication stopped; retained copies and grants remain':`${action} queued; remote receipt pending`);});
}
