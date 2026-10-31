import {randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Command} from 'commander';
import {store, getProfile, setRuntimeProfile, invalidateAllProfileCaches} from '../../src/lib/config.js';
import {registerAuthCommands} from '../../src/commands/auth.js';
import {terminalQrLogin} from '../../src/lib/qr-login-presentation.js';
import {retireStoredCliRecovery} from '../../src/lib/cli-recovery.js';

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
  vi.mocked(terminalQrLogin).mockResolvedValue({success:true, user:{id:'fixture',username:'fixture',role:'user',tenantId:'fixture',mfaVerified:true}});
  vi.mocked(retireStoredCliRecovery).mockResolvedValue(undefined);
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
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:false,expectedPreference:'off'});
  await login();
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:false,expectedPreference:'off'});
  await login('--remember-iphone');
  expect(getProfile('fixture')?.cliRecoveryPreference).toBe('auto');
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:true,expectedPreference:'auto'});
  await login();
  expect(terminalQrLogin).toHaveBeenLastCalledWith(expect.anything(), {rememberIphone:'auto',expectedPreference:'auto'});
  expect(getProfile('neighbor')).toEqual(neighbor);
});
it('retires the previous grant before fresh automatic enrollment without carrying its authority forward', async () => {
  const {mutateProfileAuthentication} = await import('../../src/lib/config.js');
  mutateProfileAuthentication('fixture', p => ({...p,cliRecovery:{state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin:p.url,expiresAtSec:Math.floor(Date.now()/1000)+2592000}}));
  vi.mocked(retireStoredCliRecovery).mockImplementationOnce(async name => {
    mutateProfileAuthentication(name, p => {delete p.cliRecovery;return p;});
  });
  vi.mocked(terminalQrLogin).mockImplementationOnce(async () => {
    expect(getProfile('fixture')?.cliRecovery).toBeUndefined();
    return {success:true,user:{id:'fixture',username:'fixture',role:'user',tenantId:'fixture',mfaVerified:true}};
  });
  await login();
  expect(retireStoredCliRecovery).toHaveBeenCalledExactlyOnceWith('fixture');
  expect(terminalQrLogin).toHaveBeenCalledWith(expect.anything(),{rememberIphone:'auto',expectedPreference:null});
});
it('pending retirement blocks replacement QR instead of silently starting another session', async () => {
  vi.mocked(retireStoredCliRecovery).mockRejectedValueOnce(new Error('revocation pending'));
  const exit = vi.spyOn(process,'exit').mockImplementation(() => {throw new Error('expected refusal');});
  try {await expect(login()).rejects.toThrow('expected refusal');expect(terminalQrLogin).not.toHaveBeenCalled();}
  finally {exit.mockRestore();}
});
