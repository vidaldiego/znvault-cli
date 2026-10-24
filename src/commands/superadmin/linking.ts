import {randomUUID} from 'node:crypto';
import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import {getActiveProfileName} from '../../lib/config.js';
import {promptConfirm} from '../../lib/prompts.js';
import {consentProfiles,linkingOperation,profileOrigin,withLinkProfile,type ConsentOptions,type LinkOutputOptions} from '../../lib/linking.js';

interface CreateOptions extends LinkOutputOptions {destinationProfile:string;tenant:string;peerTenant:string}
interface ActionOptions extends LinkOutputOptions {yes?:boolean}
export function registerLinkingCommands(parent:Command):void {
  const linking=parent.command('linking').description('One-way Vault links; no automatic tenant or secret access');
  for(const action of ['list','status'])linking.command(action).option('--json','Redacted metadata').action(async(options:LinkOutputOptions)=>{
    await linkingOperation(async()=>await client.get('/v1/superadmin/linking'),options,'Link metadata');
  });
  linking.command('create <name>').description('Create peer mappings with two superadmin profiles; exports remain disabled until tenant consent')
    .requiredOption('--destination-profile <name>','Existing destination superadmin profile')
    .requiredOption('--tenant <id>','Source tenant mapping').requiredOption('--peer-tenant <id>','Destination tenant mapping')
    .option('--json','Redacted metadata')
    .action(async(name:string,options:CreateOptions)=>{
      await linkingOperation(async()=>{
        const sourceProfile=getActiveProfileName(),sourceApiOrigin=profileOrigin(sourceProfile),destinationOrigin=profileOrigin(options.destinationProfile);
        if(sourceApiOrigin===destinationOrigin)throw new Error('LINKING_DISTINCT_INSTALLATIONS_REQUIRED');
        const source=await withLinkProfile(sourceProfile,async peer=>await peer.get<{installationId:string}>('/v1/superadmin/linking'));
        const destination=await withLinkProfile(options.destinationProfile,async peer=>await peer.get<{installationId:string}>('/v1/superadmin/linking'));
        if(!source.installationId||!destination.installationId||source.installationId===destination.installationId)throw new Error('LINKING_DISTINCT_INSTALLATIONS_REQUIRED');
        const generation=randomUUID(),body={name,sourceApiOrigin,destinationOrigin};
        const sourceConnection=await withLinkProfile(sourceProfile,async peer=>await peer.post<{id:string}>('/v1/superadmin/linking',body));
        const destinationConnection=await withLinkProfile(options.destinationProfile,async peer=>await peer.post<{id:string}>('/v1/superadmin/linking',body));
        const sourceBinding=await withLinkProfile(sourceProfile,async peer=>await peer.post<{id:string}>(`/v1/superadmin/linking/${encodeURIComponent(sourceConnection.id)}/bindings?tenantId=${encodeURIComponent(options.tenant)}`,{direction:'source',peerInstallationId:destination.installationId,peerTenant:options.peerTenant,generation}));
        const destinationBinding=await withLinkProfile(options.destinationProfile,async peer=>await peer.post<{id:string}>(`/v1/superadmin/linking/${encodeURIComponent(destinationConnection.id)}/bindings?tenantId=${encodeURIComponent(options.peerTenant)}`,{direction:'destination',peerInstallationId:source.installationId,peerBindingId:sourceBinding.id,peerTenant:options.tenant,generation}));
        return {sourceBindingId:sourceBinding.id,destinationBindingId:destinationBinding.id,generation};
      },options,'Mappings created; no export is authorised. Complete explicit tenant consent.');
    });
  linking.command('consent').description('Exchange existing least-scope keys in memory using two tenant JWT profiles')
    .requiredOption('--source-profile <name>','Existing source tenant JWT profile')
    .requiredOption('--destination-profile <name>','Existing destination tenant JWT profile')
    .requiredOption('--source-binding <id>','Source binding UUID').requiredOption('--destination-binding <id>','Destination binding UUID')
    .option('--receiver-key-file <path>','Owner-only regular file; otherwise masked prompt')
    .option('--export-key-file <path>','Owner-only regular file; otherwise masked prompt')
    .option('--json','Redacted metadata')
    .action(async(options:ConsentOptions&LinkOutputOptions)=>{await linkingOperation(async()=>await consentProfiles(options),options,'Tenant consent recorded; no secrets selected.');});
  linking.command('revoke-local <bindingId>').description('Stop an incoming binding locally using a destination tenant JWT; retains copies and grants')
    .requiredOption('--request-id <uuid>','Keep and reuse this exact request UUID on retries')
    .option('-y, --yes','Confirm local incoming-transport revocation').option('--json','Redacted metadata')
    .action(async(id:string,options:ActionOptions&{requestId:string})=>{
      if(!options.yes&&!await promptConfirm('Revoke incoming transport locally? Retained copies and human grants remain.',false))return;
      await linkingOperation(async()=>{
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.requestId))throw new Error('LINKING_INVALID_REQUEST');
        return await client.post(`/v1/linking/bindings/${encodeURIComponent(id)}/revoke`,{requestId:options.requestId});
      },options,'Incoming transport revoked locally; retained copies and grants remain');
    });
  for(const action of ['test','sync','pause','resume','revoke'] as const)linking.command(`${action} <bindingId>`)
    .option('--json','Redacted metadata').option('-y, --yes','Confirm transport revocation')
    .action(async(id:string,options:ActionOptions)=>{
      if(action==='revoke'&&!options.yes&&!await promptConfirm('Revoke transport? Retained copies and human grants remain.',false))return;
      await linkingOperation(async()=>await client.post(`/v1/superadmin/linking/bindings/${encodeURIComponent(id)}/${action}`,{}),options,
        action==='sync'?'Sync queued; remote receipt pending':action==='revoke'?'Transport revocation requested; inspect remote confirmation status':`${action} accepted`);
    });
}
