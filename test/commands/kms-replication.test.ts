import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Command} from 'commander';
const net=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),request:vi.fn(),delete:vi.fn(),patch:vi.fn()}));
const spinner=vi.hoisted(()=>({start:vi.fn(function(){return spinner;}),stop:vi.fn(),fail:vi.fn()}));
vi.mock('../../src/lib/client.js',()=>({client:net,VaultClient:vi.fn(function(){return net;})}));
vi.mock('../../src/lib/output.js',()=>({json:vi.fn(),info:vi.fn(),error:vi.fn(),success:vi.fn(),warn:vi.fn(),spinner:()=>spinner}));
vi.mock('../../src/lib/auth-context.js',()=>({getAuthContext:()=>({tenantId:'tenant'})}));
vi.mock('../../src/lib/config.js',()=>({getActiveProfileName:()=> 'source',setRuntimeProfile:vi.fn(),getProfile:()=>({url:'https://source.example.com',credentials:{accessToken:'jwt'}})}));
vi.mock('../../src/lib/prompts.js',()=>({promptPassword:vi.fn(),promptConfirm:vi.fn()}));
import {registerKmsCommands} from '../../src/commands/kms/index.js';
import * as output from '../../src/lib/output.js';
const key='11111111-1111-4111-8111-111111111111',binding='22222222-2222-4222-8222-222222222222',selection='33333333-3333-4333-8333-333333333333';
function program(admin=false):Command {const p=new Command().exitOverride();registerKmsCommands(p,admin?{context:'superadmin'}:undefined);return p;}
async function run(...args:string[]):Promise<void>{await program().parseAsync(['kms',...args],{from:'user'});}
beforeEach(()=>{vi.clearAllMocks();net.post.mockResolvedValue({id:selection,state:'pending',capsule:'sensitive',grantToken:'sensitive'});net.get.mockResolvedValue({items:[{id:selection,keyId:key,bindingId:binding,state:'active'}]});net.request.mockResolvedValue({keyId:key,replication:{selectionId:selection,state:'pending'}});});
afterEach(()=>{process.exitCode=0;});
describe('selective KMS replication',()=>{
  it('enables exactly one UUID and filters response material',async()=>{await run('replication','enable',key,'--link',binding,'--json');expect(net.post).toHaveBeenCalledWith(`/v1/kms/keys/${key}/replication`,{bindingId:binding});expect(output.json).toHaveBeenCalledWith({id:selection,state:'pending'});});
  it.each(['sync','stop','resume'])('%s resolves only the selected binding with no polling',async action=>{await run('replication',action,key,'--link',binding,'--json');expect(net.get).toHaveBeenCalledTimes(1);expect(net.post).toHaveBeenCalledWith(`/v1/kms/keys/${key}/replication/${selection}/${action}`,{});});
  it('status retains pending metadata without material',async()=>{net.get.mockResolvedValueOnce({items:[{id:selection,desiredRevision:4,acknowledgedRevision:3,pendingOperationId:'op',wrappedKey:'sensitive'}]});await run('replication','status',key,'--json');expect(output.json).toHaveBeenCalledWith({items:[{id:selection,desiredRevision:4,acknowledgedRevision:3,pendingOperationId:'op'}]});expect(net.post).not.toHaveBeenCalled();});
  it('rejects aliases and ambiguous selections before mutation',async()=>{await run('replication','enable','alias/name','--link',binding,'--json');expect(net.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_INVALID_REQUEST');});
  it('does not expose replication in the superadmin KMS tree',()=>{expect(program(true).commands[0].commands.map(c=>c.name())).not.toContain('replication');});
  it('reduces structured remote errors to stable codes',async()=>{net.post.mockRejectedValueOnce(Object.assign(new Error('capsule sensitive'),{errorCode:'KMS_REPLICATION_PENDING',details:{capsule:'sensitive'}}));await run('replication','enable',key,'--link',binding,'--json');expect(output.error).toHaveBeenCalledWith('KMS_REPLICATION_PENDING');});
  it('preserves literal alias and explicit replication selection with idempotency',async()=>{await run('create','--alias','zincapp/Foo','--replicate-to',binding,'--request-id',key,'--json');expect(net.request).toHaveBeenCalledWith({method:'POST',path:'/v1/kms/keys',body:expect.objectContaining({alias:'zincapp/Foo',replication:{bindingId:binding}}),headers:{'Idempotency-Key':key}});expect(output.json).toHaveBeenCalledWith({keyId:key,replication:{selectionId:selection,state:'pending'},requestId:key});});
  it('keeps an unselected creation local with the literal alias',async()=>{await run('create','--alias','zincapp/Local','--json');expect(net.post).toHaveBeenCalledWith('/v1/kms/keys',expect.objectContaining({alias:'zincapp/Local'}));expect(net.post.mock.calls[0][1]).not.toHaveProperty('replication');});
  it('rotation retry reuses the supplied request UUID and returns only pending metadata',async()=>{net.request.mockRejectedValue(Object.assign(new Error('capsule sensitive'),{errorCode:'KMS_REPLICATION_PENDING',details:{code:'KMS_REPLICATION_PENDING',operationId:'op',version:2,capsule:'sensitive'}}));for(let i=0;i<2;i++)await run('rotate',key,'--request-id',binding,'--json');expect(net.request).toHaveBeenCalledTimes(2);expect(net.request).toHaveBeenLastCalledWith({method:'POST',path:`/v1/kms/keys/${key}/rotate`,body:{},headers:{'Idempotency-Key':binding}});expect(output.json).toHaveBeenCalledWith({operationId:'op',version:2,requestId:binding});expect(JSON.stringify(vi.mocked(output.json).mock.calls)).not.toContain('sensitive');});
  it('renders paginated versions through an allowlist',async()=>{net.get.mockResolvedValueOnce({items:[{version:2,algorithm:'AES_256',status:'PENDING',createdAt:'2026-11-06',isPrimary:false,isPending:true,keyMaterial:'sensitive'}],total:2,limit:1,offset:1});await run('versions',key,'--limit','1','--offset','1','--json');expect(net.get).toHaveBeenCalledWith(`/v1/kms/keys/${key}/versions?limit=1&offset=1`);expect(output.json).toHaveBeenCalledWith({items:[{version:2,algorithm:'AES_256',status:'PENDING',createdAt:'2026-11-06',isPrimary:false,isPending:true}],total:2,limit:1,offset:1});});
  it.each(['kms:Encrypt','kms:Decrypt','kms:Encrypt,kms:Decrypt'])('local grant preserves exact actions %s without adding permissions',async operations=>{net.post.mockResolvedValueOnce({grantId:'grant'});await run('grant','create',key,'--grantee','apikey:key_0123456789abcdef0123456789abcdef','--operations',operations,'--json');expect(net.post).toHaveBeenCalledWith('/v1/kms/grants',{keyId:key,granteePrincipal:'apikey:key_0123456789abcdef0123456789abcdef',operations:operations.split(',')});expect(output.json).toHaveBeenCalledWith({grantId:'grant'});});
  it('recovery versions forces decrypt only',async()=>{net.post.mockResolvedValueOnce({grantId:'grant'});await run('grant','create',key,'--grantee','user:u','--operations','kms:Encrypt','--recovery-versions','1,2','--json');expect(net.post).toHaveBeenCalledWith('/v1/kms/grants',{keyId:key,granteePrincipal:'user:u',operations:['kms:Decrypt'],recoveryVersions:[1,2]});});
});

describe('KMS validation and output boundaries',()=>{
  it('does not print undefined grant tokens in plain output',async()=>{const log=vi.spyOn(console,'log').mockImplementation(()=>{});net.post.mockResolvedValueOnce({grantId:'grant'});await run('grant','create',key,'--grantee','user:u','--operations','kms:Decrypt');expect(log.mock.calls.flat().join(' ')).not.toMatch(/undefined|Grant token/);log.mockRestore();});
  it.each(['0','256','1,1','1,no',''])('rejects invalid recovery versions %s before a grant is created',async versions=>{await run('grant','create',key,'--grantee','user:u','--operations','kms:Encrypt','--recovery-versions',versions,'--json');expect(net.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('KMS_RECOVERY_VERSIONS_INVALID');});
  it('refuses ambiguous retained selections without an explicit selection UUID',async()=>{net.get.mockResolvedValueOnce({items:[{id:selection,bindingId:binding},{id:key,bindingId:binding}]});await run('replication','sync',key,'--link',binding,'--json');expect(net.post).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_AMBIGUOUS_SELECTION');});
  it('rejects invalid request ID before creating a key',async()=>{await run('create','--request-id','bad','--json');expect(net.post).not.toHaveBeenCalled();expect(net.request).not.toHaveBeenCalled();expect(output.error).toHaveBeenCalledWith('LINKING_INVALID_REQUEST');});
});

describe('KMS tenant surface isolation',()=>{
  it('does not accept replication selection on superadmin create',async()=>{await expect(program(true).parseAsync(['kms','create','--replicate-to',binding],{from:'user'})).rejects.toThrow(/unknown option/);expect(net.post).not.toHaveBeenCalled();expect(net.request).not.toHaveBeenCalled();});
});

describe('plain KMS creation reports the server replication decision',()=>{
  afterEach(()=>vi.restoreAllMocks());
  const created={keyId:key,alias:'zincapp/new',arn:'arn:synthetic:key',createdDate:'2026-11-06T12:00:00Z',keyState:'Enabled',keyUsage:'ENCRYPT_DECRYPT',keySpec:'AES_256'};
  it('shows a pending selection created by an accepted prefix rule without --replicate-to',async()=>{
    vi.spyOn(console,'log').mockImplementation(()=>{});
    net.post.mockResolvedValueOnce({...created,replication:{selectionId:selection,state:'pending',capsule:'sensitive'}});
    await run('create','--alias','zincapp/new');
    expect(net.post).toHaveBeenCalledWith('/v1/kms/keys',expect.not.objectContaining({replication:expect.anything()}));
    expect(output.info).toHaveBeenCalledWith(expect.stringContaining('remote receipt pending'));
    expect(output.json).toHaveBeenCalledWith(expect.objectContaining({replication:{selectionId:selection,state:'pending'}}));
    expect(JSON.stringify(vi.mocked(output.json).mock.calls)).not.toContain('sensitive');
    expect(net.get).not.toHaveBeenCalled();
  });
  it('reports a protected idempotent replay without presenting it as pending',async()=>{
    vi.spyOn(console,'log').mockImplementation(()=>{});
    net.request.mockResolvedValueOnce({...created,replication:{selectionId:selection,state:'protected',grantToken:'sensitive'}});
    await run('create','--alias','zincapp/new','--replicate-to',binding,'--request-id',key);
    expect(output.info).toHaveBeenCalledWith(expect.stringContaining('replication protected'));
    expect(vi.mocked(output.info).mock.calls.flat().join(' ')).not.toContain('pending');
    expect(output.json).toHaveBeenCalledWith(expect.objectContaining({replication:{selectionId:selection,state:'protected'}}));
    expect(JSON.stringify(vi.mocked(output.json).mock.calls)).not.toContain('sensitive');
    expect(net.request).toHaveBeenCalledWith(expect.objectContaining({headers:{'Idempotency-Key':key}}));
    expect(net.get).not.toHaveBeenCalled();
  });
});
