import {randomUUID} from 'node:crypto';
import type {Command} from 'commander';
import {client} from '../../lib/client.js';
import {consentKmsProfiles,type KmsConsentOptions} from '../../lib/linking-kms.js';
import {getActiveProfileName} from '../../lib/config.js';
import {promptConfirm} from '../../lib/prompts.js';
import {consentProfiles,linkStatusAge,linkingOperation,profileOrigin,withLinkProfile,type LinkOutputOptions} from '../../lib/linking.js';

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
    .option('--kms','Consent KMS transport using the receiving key only')
    .option('--source-signer-pin <base64>','Explicit source signer SPKI pin')
    .option('--destination-signer-pin <base64>','Explicit destination signer SPKI pin')
    .option('--destination-recipient-pin <base64>','Explicit destination recipient SPKI pin')
    .option('--receiver-key-file <path>','Owner-only regular file; otherwise masked prompt')
    .option('--export-key-file <path>','Owner-only regular file; otherwise masked prompt')
    .option('--json','Redacted metadata')
    .action(async(options:KmsConsentOptions&LinkOutputOptions,command:Command)=>{await linkingOperation(async()=>{
      const globals=command.optsWithGlobals<{insecure?:boolean;url?:string}>();
      if(options.kms&&(globals.insecure||globals.url!==undefined))throw new Error('LINKING_SECURE_PROFILE_REQUIRED');
      return options.kms?await consentKmsProfiles(options):await consentProfiles(options);
    },options,'Tenant consent recorded; no resources selected.');});
  const rules=linking.command('rules').description('Literal alias-prefix rules include matching current and future objects; explicit consent remains required');
  for(const action of ['preview','create'] as const)rules.command(`${action} <bindingId>`)
    .requiredOption('--kind <kind>','secret or kms_key').requiredOption('--alias-prefix <prefix>','Literal, case-sensitive alias prefix; includes future matching objects')
    .option('--json','Public metadata only').action(async(id:string,options:LinkOutputOptions&{kind:string;aliasPrefix:string})=>{
      await linkingOperation(async()=>{
        const resourceKind=ruleKind(options.kind);
        if(!options.aliasPrefix.length||options.aliasPrefix.length>500||/\p{Cc}/u.test(options.aliasPrefix))throw new Error('LINKING_RULE_INVALID_SELECTOR');
        return await client.post(`/v1/linking/bindings/${encodeURIComponent(id)}/rules${action==='preview'?'/preview':''}`,{resourceKind,selector:{kind:'prefix',value:options.aliasPrefix}});
      },options,action==='preview'?'Preview includes matching current and future objects':'Rule created for matching current and future objects; consent remains pending');
    });
  for(const action of ['list','status'] as const)rules.command(`${action} <bindingId>`).requiredOption('--kind <kind>','secret or kms_key').option('--json','Public metadata only')
    .action(async(id:string,options:LinkOutputOptions&{kind:string})=>{await linkingOperation(async()=>await client.get(`/v1/linking/bindings/${encodeURIComponent(id)}/rules${action==='status'?'/status':''}?resourceKind=${ruleKind(options.kind)}`),options,action==='status'?'Rule state and blocked/retained memberships; inspect sync-status for confirmed revision and age':'Rule metadata');});
  for(const action of ['consent','disable'] as const)rules.command(`${action} <bindingId> <ruleId>`).requiredOption('--revision <revision>','Exact reviewed rule revision')
    .option('--confirm-protection-withdrawal','Explicitly acknowledge withdrawal of required protection').option('--json','Public metadata only')
    .action(async(id:string,ruleId:string,options:LinkOutputOptions&{revision:string;confirmProtectionWithdrawal?:boolean})=>{await linkingOperation(async()=>{
      if(!/^[1-9][0-9]{0,18}$/.test(options.revision))throw new Error('LINKING_REVISION_INVALID');
      return await client.post(`/v1/linking/bindings/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}/${action}`,{revision:options.revision,...(action==='disable'&&options.confirmProtectionWithdrawal?{confirmProtectionWithdrawal:true}:{})});
    },options,action==='disable'?'Rule disabled; retained copies and local grants remain':'Local consent recorded for this revision; peer consent is independent');});
  linking.command('verify <bindingId>').requiredOption('--kind <kind>','secret or kms_key').option('--json','Public metadata only')
    .action(async(id:string,options:LinkOutputOptions&{kind:string})=>{await linkingOperation(async()=>await client.post(`/v1/linking/bindings/${encodeURIComponent(id)}/verify`,{resourceKind:ruleKind(options.kind)}),options,'Finite verification queued; inspect sync-status explicitly');});
  linking.command('sync-status <bindingId>').requiredOption('--kind <kind>','secret or kms_key').option('--json','Public metadata only')
    .action(async(id:string,options:LinkOutputOptions&{kind:string})=>{await linkingOperation(async()=>linkStatusAge(await client.get(`/v1/linking/bindings/${encodeURIComponent(id)}/sync-status?resourceKind=${ruleKind(options.kind)}`)),options,'Confirmed transport does not grant cryptographic use; inspect local grants separately');});
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

function ruleKind(value:string):'secret'|'kms_key' {
  if(value!=='secret'&&value!=='kms_key')throw new Error('LINKING_RULE_INVALID_KIND');
  return value;
}
