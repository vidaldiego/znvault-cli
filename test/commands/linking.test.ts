import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Command} from 'commander';
const net=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),delete:vi.fn()}));
vi.mock('../../src/lib/client.js',()=>({client:net,VaultClient:vi.fn(function(){return net;})}));
vi.mock('../../src/lib/output.js',()=>({json:vi.fn(),info:vi.fn(),error:vi.fn(),success:vi.fn()}));
vi.mock('../../src/lib/config.js',()=>({getActiveProfileName:vi.fn(()=> 'source'),setRuntimeProfile:vi.fn(),getProfile:vi.fn((name:string)=>({url:`https://${name}.example.com`,insecure:false}))}));
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
});
