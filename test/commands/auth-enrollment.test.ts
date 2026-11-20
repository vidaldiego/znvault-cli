import {randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Command} from 'commander';
import {store, getProfile, setRuntimeProfile, invalidateAllProfileCaches} from '../../src/lib/config.js';
import {registerAuthCommands} from '../../src/commands/auth.js';
import {terminalQrLogin} from '../../src/lib/qr-login-presentation.js';
import {retireStoredCliRecovery} from '../../src/lib/cli-recovery.js';
import {qrLogin} from '../../src/lib/qr-login.js';
import {client} from '../../src/lib/client.js';
import {authenticationFingerprint} from '../../src/lib/config.js';

vi.mock('ink', () => ({render: vi.fn()}));
vi.mock('../../src/tui/ProfileManager.js', () => ({ProfileManager: vi.fn()}));
vi.mock('../../src/lib/output.js', () => ({success: vi.fn(), error: vi.fn(), keyValue: vi.fn()}));
vi.mock('../../src/lib/qr-login-presentation.js', () => ({terminalQrLogin: vi.fn(), terminalCliRecovery: vi.fn()}));
vi.mock('../../src/lib/web-login.js', () => ({isWebLoginSupported: () => true, webLogin: vi.fn()}));
vi.mock('../../src/lib/cli-recovery.js', () => ({coordinateCliRecovery: vi.fn(), retireStoredCliRecovery: vi.fn()}));
const tty = [process.stdin, process.stdout].map(stream => Object.getOwnPropertyDescriptor(stream, 'isTTY'));

beforeEach(() => {
  for (const key of ['ZNVAULT_PROFILE', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD', 'ZNVAULT_API_KEY']) vi.stubEnv(key, undefined);
  store.set('activeProfile', 'fixture');
  store.set('profiles', {fixture: {url:'https://vault.example.test', insecure:false, timeout:1000}, neighbor: {url:'https://neighbor.example.test',insecure:false,timeout:1000}});
  setRuntimeProfile(null);invalidateAllProfileCaches();
  for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', {configurable:true, value:true});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(terminalQrLogin).mockImplementation(async(_peer,options)=>{
    await options?.beforeStart?.(authenticationFingerprint(getProfile('fixture')));
    return {success:true,user:{id:'fixture',username:'fixture',role:'user',tenantId:'fixture',mfaVerified:true}};
  });
  vi.mocked(retireStoredCliRecovery).mockImplementation(async name=>getProfile(name));
});
afterEach(() => {
  vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllEnvs();setRuntimeProfile(null);invalidateAllProfileCaches();
  [process.stdin, process.stdout].forEach((stream, index) => {
    if(tty[index]) Object.defineProperty(stream,'isTTY',tty[index]!);else Reflect.deleteProperty(stream,'isTTY');
  });
});
async function login(...args: string[]) {
  const program = new Command().exitOverride();registerAuthCommands(program);
  await program.parseAsync(['node','test','login','--qr',...args]);
}
it('persists opt-out and restores automatic enrollment only after explicit re-enable', async () => {
  const neighbor = structuredClone(getProfile('neighbor'));
  await login('--no-remember-iphone');
  expect(getProfile('fixture')?.cliRecoveryPreference).toBe('off');
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:false,expectedPreference:null,beforeStart:expect.any(Function)});
  await login();
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:false,expectedPreference:'off',beforeStart:expect.any(Function)});
  await login('--remember-iphone');
  expect(getProfile('fixture')?.cliRecoveryPreference).toBe('auto');
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:true,expectedPreference:'off',beforeStart:expect.any(Function)});
  await login();
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:'auto',expectedPreference:'auto',beforeStart:expect.any(Function)});
  expect(getProfile('neighbor')).toEqual(neighbor);
});
it('retires the previous grant before fresh automatic enrollment without carrying its authority forward', async () => {
  const {mutateProfileAuthentication} = await import('../../src/lib/config.js');
  mutateProfileAuthentication('fixture', p => ({...p,cliRecovery:{state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin:p.url,expiresAtSec:Math.floor(Date.now()/1000)+2592000}}));
  vi.mocked(retireStoredCliRecovery).mockImplementationOnce(async name => {
    return mutateProfileAuthentication(name, p => {delete p.cliRecovery;return p;});
  });
  vi.mocked(terminalQrLogin).mockImplementationOnce(async (_peer,options) => {
    expect(getProfile('fixture')?.cliRecovery).toBeDefined();
    await options?.beforeStart?.(authenticationFingerprint(getProfile('fixture')));
    expect(getProfile('fixture')?.cliRecovery).toBeUndefined();
    return {success:true,user:{id:'fixture',username:'fixture',role:'user',tenantId:'fixture',mfaVerified:true}};
  });
  await login();
  expect(retireStoredCliRecovery).toHaveBeenCalledExactlyOnceWith('fixture',expect.any(String));
  expect(terminalQrLogin).toHaveBeenCalledWith(expect.anything(),{rememberIphone:'auto',expectedPreference:null,beforeStart:expect.any(Function)});
});
it('pending retirement blocks replacement QR instead of silently starting another session', async () => {
  vi.mocked(retireStoredCliRecovery).mockRejectedValueOnce(new Error('revocation pending'));
  const exit = vi.spyOn(process,'exit').mockImplementation(() => {throw new Error('expected refusal');});
  try {await expect(login()).rejects.toThrow('expected refusal');expect(retireStoredCliRecovery).toHaveBeenCalledOnce();}
  finally {exit.mockRestore();}
});
it.each(['events','remember-disabled','malformed-recovery','installation','origin-override','ambient','opt-out'])('keeps the remembered session on %s admission failure',async fault=>{
  const {mutateProfileAuthentication}=await import('../../src/lib/config.js');
  mutateProfileAuthentication('fixture',p=>({...p,authGeneration:randomUUID(),credentials:{accessToken:'public-synthetic-access',refreshToken:'public-synthetic-refresh',expiresAt:Date.now()+3600000,userId:'fixture',username:'fixture',role:'user',tenantId:'fixture'},cliRecovery:{state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin:p.url,installationId:randomUUID(),expiresAtSec:Math.floor(Date.now()/1000)+2592000}}));
  const before=structuredClone(getProfile('fixture'));
  vi.mocked(terminalQrLogin).mockImplementationOnce(async(peer,options)=>await qrLogin(peer,{...options,onPending:vi.fn()}));
  vi.spyOn(client,'request').mockImplementation(async options=>{
    options.sessionGuard?.();
    if(!options.path.endsWith('/protocol'))throw new Error('Unexpected post-admission request');
    return {protocolVersion:3,origin:'https://vault.example.test',installationId:before?.cliRecovery?.installationId,deviceLogin:{version:1,enabled:true},
      waitEvents:{version:1,enabled:fault!=='events'&&fault!=='opt-out'},cliRecovery:{version:1,enabled:true},
      ...(fault==='remember-disabled'?{cliRecovery:{version:1,enabled:false}}:fault==='malformed-recovery'?{cliRecovery:{version:1,enabled:'false'}}:fault==='installation'?{installationId:randomUUID()}:{})} as never;
  });
  if(fault==='origin-override')vi.spyOn(client,'getBaseUrl').mockReturnValue('https://other.example.test');
  if(fault==='ambient')vi.stubEnv('ZNVAULT_USERNAME','fixture');
  const exit=vi.spyOn(process,'exit').mockImplementation(()=>{throw new Error('expected refusal');});
  try{
    await expect(login(...(fault==='remember-disabled'?['--remember-iphone']:fault==='opt-out'?['--no-remember-iphone']:[]))).rejects.toThrow('expected refusal');
    expect(retireStoredCliRecovery).not.toHaveBeenCalled();
    expect(getProfile('fixture')).toEqual(before);
  }finally{exit.mockRestore();}
});
