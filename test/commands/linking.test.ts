import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Command} from 'commander';
const net=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),delete:vi.fn()}));
vi.mock('../../src/lib/client.js',()=>({client:net,VaultClient:vi.fn(function(){return net;})}));
vi.mock('../../src/lib/output.js',()=>({json:vi.fn(),info:vi.fn(),error:vi.fn(),success:vi.fn()}));
vi.mock('../../src/lib/config.js',()=>({getActiveProfileName:vi.fn(()=> 'source'),setRuntimeProfile:vi.fn(),getProfile:vi.fn((name:string)=>({url:`https://${name}.example.com`,insecure:false,credentials:{accessToken:`${name}-jwt`}}))}));
vi.mock('../../src/lib/prompts.js',()=>({promptPassword:vi.fn(),promptConfirm:vi.fn(()=>true)}));
import {client} from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';
import {registerLinkingCommands} from '../../src/commands/superadmin/linking.js';
import {registerReplicationCommands} from '../../src/commands/secret/replication.js';
import {registerGrantCommands} from '../../src/commands/secret/grants.js';
import {sanitiseLinkMetadata,consentProfiles} from '../../src/lib/linking.js';
import {setRuntimeProfile} from '../../src/lib/config.js';
import {promptPassword} from '../../src/lib/prompts.js';

function program():Command {
  const p=new Command().exitOverride();registerLinkingCommands(p);
  const secret=p.command('secret');registerReplicationCommands(secret);registerGrantCommands(secret);return p;
}
const id='11111111-1111-4111-8111-111111111111';
const state={bindings:[{id:'binding',name:'offsite',direction:'source',state:'active'}],selections:[{id:'selection',binding_id:'binding',source_secret_id:id,lifecycle:'active'}]};
describe('explicit linking CLI',()=>{
  afterEach(()=>{process.exitCode=0;});
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(client.get).mockResolvedValue(state);vi.mocked(client.post).mockResolvedValue({queued:true});});
  it.each(['list','status'])('%s only reads metadata',async action=>{
    await program().parseAsync(['linking',action,'--json'],{from:'user'});
    expect(client.get).toHaveBeenCalledWith('/v1/superadmin/linking');expect(client.post).not.toHaveBeenCalled();
  });
  it.each(['test','sync','pause','resume','revoke'])('%s addresses exactly the selected binding',async action=>{
    await program().parseAsync(['linking',action,'binding','--json','--yes'],{from:'user'});
    expect(client.post).toHaveBeenCalledWith(`/v1/superadmin/linking/bindings/binding/${action}`,{});
    expect(output.success).not.toHaveBeenCalled();
  });
  it.each(['enable','status','sync','stop'])('secret replication %s resolves named link without a tenant selector or decrypt',async action=>{
    await program().parseAsync(['secret','replication',action,id,'--link','offsite','--alias','retained/canary','--json'],{from:'user'});
    expect(JSON.stringify(vi.mocked(client.get).mock.calls)).not.toContain('decrypt');
    if(action==='enable')expect(client.post).toHaveBeenCalledWith(`/v1/secrets/${id}/replication`,{bindingId:'binding',destinationAlias:'retained/canary'});
    if(action==='sync')expect(client.post).toHaveBeenCalledWith(`/v1/secrets/${id}/replication/selection/sync`,{});
  });
  it('linked grant pins the prepared key and never falls back to root/local grants',async()=>{
    vi.mocked(client.get).mockImplementation(async path=>path.endsWith('/recipients?selectionId=selection')?{recipients:[{userId:'remote-human',keyReady:true,keyVersion:3,fingerprint:'SHA256:pinned'}]}:state);
    await program().parseAsync(['secret','grant',id,'--user','remote-human','--link','offsite','--fingerprint','SHA256:pinned','--json'],{from:'user'});
    expect(client.post).toHaveBeenCalledWith(`/v1/secrets/${id}/replication/grants`,{selectionId:'selection',userId:'remote-human',keyVersion:3,fingerprint:'SHA256:pinned'});
  });
  it('retains local grant behaviour without --link',async()=>{
    await program().parseAsync(['secret','grant',id,'--user','local-human'],{from:'user'});
    expect(client.post).toHaveBeenCalledWith(`/v1/secrets/${id}/user-grants`,{userId:'local-human'});
  });
  it('ordinary JSON drops values, credentials and grant envelopes recursively',()=>{
    const clean=sanitiseLinkMetadata({bindings:[{id:'binding',receive_credential:{ciphertext:'secret'},last_error:'LINKING_OFFLINE'}],recipients:[{userId:'u',fingerprint:'SHA256:public',wrappedSak:'secret'}],data:'secret',key:'secret',privateKey:'secret'});
    expect(JSON.stringify(clean)).not.toContain('secret');expect(clean).toMatchObject({bindings:[{id:'binding'}],recipients:[{userId:'u'}]});
  });
  it('exchanges protected input between two tenant profiles only in memory and restores runtime profile',async()=>{
    vi.mocked(promptPassword).mockResolvedValueOnce('receiver-secret').mockResolvedValueOnce('export-secret');
    const receipt=await consentProfiles({sourceProfile:'source',destinationProfile:'destination',sourceBinding:'source-binding',destinationBinding:'destination-binding'});
    expect(client.post).toHaveBeenNthCalledWith(1,'/v1/linking/bindings/destination-binding/consent',{peerBindingId:'source-binding',receiverKey:'receiver-secret'});
    expect(client.post).toHaveBeenNthCalledWith(2,'/v1/linking/bindings/source-binding/consent',{peerBindingId:'destination-binding',receiverKey:'receiver-secret',exportKey:'export-secret'});
    expect(JSON.stringify(receipt)).not.toContain('secret');expect(setRuntimeProfile).toHaveBeenLastCalledWith('source');
  });
  it('create configures two metadata mappings without consenting, selecting or issuing keys',async()=>{
    vi.mocked(client.get).mockResolvedValueOnce({installationId:'source-id'}).mockResolvedValueOnce({installationId:'destination-id'});
    vi.mocked(client.post).mockResolvedValueOnce({id:'source-connection'}).mockResolvedValueOnce({id:'destination-connection'}).mockResolvedValueOnce({id:'source-binding'}).mockResolvedValueOnce({id:'destination-binding'});
    await program().parseAsync(['linking','create','offsite','--destination-profile','destination','--tenant','source-tenant','--peer-tenant','destination-tenant','--json'],{from:'user'});
    expect(client.post).toHaveBeenCalledTimes(4);
    expect(vi.mocked(client.post).mock.calls[2]?.[0]).toBe('/v1/superadmin/linking/source-connection/bindings?tenantId=source-tenant');
    expect(JSON.stringify(vi.mocked(client.post).mock.calls)).not.toMatch(/consent|api-keys|replication/);
    expect(output.json).toHaveBeenCalledWith(expect.objectContaining({sourceBindingId:'source-binding',destinationBindingId:'destination-binding'}));
  });
  it('refuses an unpinned human grant with a stable error before any mutation',async()=>{
    await program().parseAsync(['secret','grant',id,'--user','remote-human','--link','offsite','--json'],{from:'user'});
    expect(client.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_RECIPIENT_PIN_REQUIRED');
  });
  it('does not reflect credentials from an untrusted error response',async()=>{
    vi.mocked(client.post).mockRejectedValue(new Error('failed receiver-secret export-secret'));
    await program().parseAsync(['linking','sync','binding','--json'],{from:'user'});
    expect(output.error).toHaveBeenCalledWith('LINKING_REQUEST_FAILED');
    expect(JSON.stringify(vi.mocked(output).json.mock.calls)).not.toContain('secret');
  });
  it('linked revoke does not call local grants or report a confirmed remote revoke',async()=>{
    await program().parseAsync(['secret','revoke',id,'--user','remote-human','--link','offsite','--json'],{from:'user'});
    expect(client.delete).toHaveBeenCalledWith(`/v1/secrets/${id}/replication/grants/remote-human?selectionId=selection`);
    expect(output.success).not.toHaveBeenCalled();
  });
  it('requires an explicit selection when retained crypto identities share a source UUID',async()=>{
    vi.mocked(client.get).mockResolvedValue({...state,selections:[{...state.selections[0],id:'closed',lifecycle:'closed'},state.selections[0]]});
    await program().parseAsync(['secret','replication','sync',id,'--link','offsite','--selection','selection','--json'],{from:'user'});
    expect(client.post).toHaveBeenCalledWith(`/v1/secrets/${id}/replication/selection/sync`,{});
  });
  it('destination-local revoke uses tenant endpoint and reuses the operator request ID',async()=>{
    for(let attempt=0;attempt<2;attempt++)await program().parseAsync(['linking','revoke-local','incoming','--request-id',id,'--json','--yes'],{from:'user'});
    expect(client.post).toHaveBeenNthCalledWith(1,'/v1/linking/bindings/incoming/revoke',{requestId:id});
    expect(client.post).toHaveBeenNthCalledWith(2,'/v1/linking/bindings/incoming/revoke',{requestId:id});
  });
});

describe('KMS linking tenant controls',()=>{
  const pin='MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const args=['linking','consent','--kms','--source-profile','source','--destination-profile','destination','--source-binding','source-binding','--destination-binding','destination-binding','--json'];
  afterEach(()=>{process.exitCode=0;});
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(client.post).mockResolvedValue({queued:true});});
  it('requires all three explicit public pins before reading any credentials',async()=>{await program().parseAsync(args,{from:'user'});expect(promptPassword).not.toHaveBeenCalled();expect(client.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_KMS_PINS_REQUIRED');});
  it('KMS consent exchanges only the receiver credential and never requests an exporter',async()=>{vi.mocked(promptPassword).mockResolvedValueOnce('receiver-secret');await program().parseAsync([...args,'--source-signer-pin',pin,'--destination-signer-pin',pin,'--destination-recipient-pin',pin],{from:'user'});expect(promptPassword).toHaveBeenCalledTimes(1);expect(client.post).toHaveBeenNthCalledWith(1,'/v1/linking/bindings/destination-binding/kms/consent',{peerBindingId:'source-binding',receiverKey:'receiver-secret',pins:{sourceSigner:pin,destinationSigner:pin,destinationRecipient:pin}});expect(client.post).toHaveBeenNthCalledWith(2,'/v1/linking/bindings/source-binding/kms/consent',{peerBindingId:'destination-binding',receiverKey:'receiver-secret',pins:{sourceSigner:pin,destinationSigner:pin,destinationRecipient:pin}});expect(JSON.stringify(vi.mocked(output.json).mock.calls)).not.toContain('secret');});
  it.each(['preview','create'])('rules %s preserves literal prefix and kind without consenting',async action=>{await program().parseAsync(['linking','rules',action,'binding','--kind','kms_key','--alias-prefix','zincapp/','--json'],{from:'user'});expect(client.post).toHaveBeenCalledWith(`/v1/linking/bindings/binding/rules${action==='preview'?'/preview':''}`,{resourceKind:'kms_key',selector:{kind:'prefix',value:'zincapp/'}});expect(JSON.stringify(vi.mocked(client.post).mock.calls)).not.toContain('consent');});
  it('verify starts a finite job with kind body and no status loop',async()=>{await program().parseAsync(['linking','verify','binding','--kind','kms_key','--json'],{from:'user'});expect(client.post).toHaveBeenCalledWith('/v1/linking/bindings/binding/verify',{resourceKind:'kms_key'});expect(client.get).not.toHaveBeenCalled();});
  it('rules status retains rule lifecycle and membership counts without arbitrary reason data',async()=>{vi.mocked(client.get).mockResolvedValueOnce({rules:[{id:'rule',state:'pending_consent',revision:'9',selector:{kind:'prefix',value:'zincapp/'},capsule:'sensitive'}],memberships:[{blockedReason:'KMS_LINKING_UNSUPPORTED_KEY',retained:false,count:2}]});await program().parseAsync(['linking','rules','status','binding','--kind','kms_key','--json'],{from:'user'});expect(client.get).toHaveBeenCalledWith('/v1/linking/bindings/binding/rules/status?resourceKind=kms_key');expect(output.json).toHaveBeenCalledWith({rules:[{id:'rule',state:'pending_consent',revision:'9',selector:{kind:'prefix',value:'zincapp/'}}],memberships:[{blockedReason:'KMS_LINKING_UNSUPPORTED_KEY',retained:false,count:2}]});});
});

describe('linking metadata safety and reviewed rule operations',()=>{
  afterEach(()=>{process.exitCode=0;vi.useRealTimers();});
  beforeEach(()=>{vi.clearAllMocks();});
  it('keeps only public inventory reasons with nonnegative integer counts',()=>{
    expect(sanitiseLinkMetadata({blocked:{missing:2,conflict:1,storage_changed:3,credential:'sensitive',unknown:5,behind:-1,missing_versions:1.5},memberships:[{blockedReason:'sensitive',count:1}],value:'sensitive'})).toEqual({blocked:{missing:2,conflict:1,storage_changed:3},memberships:[{count:1}]});
  });
  it('sync-status shows confirmed revision and acknowledgement age separately from local permissions',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T12:00:10Z'));
    vi.mocked(client.get).mockResolvedValueOnce({scanComplete:true,pending:1,confirmed:2,blocked:{missing:1},retained:3,dirtyBuckets:1,verifiedThroughRevision:'9',oldestPendingAt:null,lastAckAt:'2026-11-06T12:00:00Z',capsule:'sensitive'});
    await program().parseAsync(['linking','sync-status','binding','--kind','kms_key','--json'],{from:'user'});
    expect(output.json).toHaveBeenCalledWith({scanComplete:true,pending:1,confirmed:2,blocked:{missing:1},retained:3,dirtyBuckets:1,verifiedThroughRevision:'9',oldestPendingAt:null,lastAckAt:'2026-11-06T12:00:00Z',lastAckAgeSeconds:10});
  });
  it('rules disable sends only reviewed revision and explicit protection withdrawal',async()=>{
    await program().parseAsync(['linking','rules','disable','binding','rule','--revision','9','--confirm-protection-withdrawal','--json'],{from:'user'});
    expect(client.post).toHaveBeenCalledWith('/v1/linking/bindings/binding/rules/rule/disable',{revision:'9',confirmProtectionWithdrawal:true});
  });
  it.each(['other','kms'])('rejects unsupported kind %s before network IO',async kind=>{
    await program().parseAsync(['linking','rules','preview','binding','--kind',kind,'--alias-prefix','zincapp/','--json'],{from:'user'});expect(client.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_RULE_INVALID_KIND');
  });
  it('rules consent records only this local reviewed revision',async()=>{
    await program().parseAsync(['linking','rules','consent','binding','rule','--revision','9','--json'],{from:'user'});
    expect(client.post).toHaveBeenCalledTimes(1);expect(client.post).toHaveBeenCalledWith('/v1/linking/bindings/binding/rules/rule/consent',{revision:'9'});
  });
});

describe('three independent KMS consent pins',()=>{
  afterEach(()=>{process.exitCode=0;});
  beforeEach(()=>vi.clearAllMocks());
  it.each(['--source-signer-pin','--destination-signer-pin','--destination-recipient-pin'])('refuses missing %s without fetching trust or protected input',async missing=>{
    const pin='MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const pins=['--source-signer-pin','--destination-signer-pin','--destination-recipient-pin'].filter(flag=>flag!==missing).flatMap(flag=>[flag,pin]);
    await program().parseAsync(['linking','consent','--kms','--source-profile','source','--destination-profile','destination','--source-binding','s','--destination-binding','d',...pins,'--json'],{from:'user'});
    expect(client.get).not.toHaveBeenCalled();expect(client.post).not.toHaveBeenCalled();expect(promptPassword).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_KMS_PINS_REQUIRED');
  });
  it('rejects an explicit insecure global override before reading keys',async()=>{
    const p=program().option('--insecure');const pin='MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    await p.parseAsync(['--insecure','linking','consent','--kms','--source-profile','source','--destination-profile','destination','--source-binding','s','--destination-binding','d','--source-signer-pin',pin,'--destination-signer-pin',pin,'--destination-recipient-pin',pin,'--json'],{from:'user'});
    expect(client.post).not.toHaveBeenCalled();expect(promptPassword).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_SECURE_PROFILE_REQUIRED');
  });
});
