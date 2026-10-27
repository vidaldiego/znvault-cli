import {Command} from 'commander';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {registerUnsealCommands} from '../../src/commands/unseal.js';
import * as config from '../../src/lib/config.js';
import * as actions from '../../src/commands/user-sealed.js';
vi.mock('../../src/commands/user-sealed.js',async importOriginal=>({...await importOriginal<typeof import('../../src/commands/user-sealed.js')>(),runIPhoneApproval:vi.fn(async()=>{})}));
let program:Command;
beforeEach(()=>{program=new Command();program.exitOverride();registerUnsealCommands(program);process.exitCode=undefined;vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();process.exitCode=undefined;});
it('a forced iPhone method bypasses stored TOTP and device autodetection',async()=>{
  const seed=vi.spyOn(config,'hasAutoUnsealSecret').mockReturnValue(true);
  await program.parseAsync(['node','test','unseal','--iphone','--scope','root','--json']);
  expect(actions.runIPhoneApproval).toHaveBeenCalledWith('unseal',expect.objectContaining({iphone:true,scope:'root'}));
  expect(seed).not.toHaveBeenCalled();
});
it.each([['--auto','--iphone'],['--device','--iphone'],['--otp','--iphone'],['--iphone-device','public-phone']])('rejects incompatible flags %s',async (...flags)=>{
  const seed=vi.spyOn(config,'hasAutoUnsealSecret');
  await program.parseAsync(['node','test','unseal','--json',...flags]);
  expect(process.exitCode).toBe(1);expect(actions.runIPhoneApproval).not.toHaveBeenCalled();expect(seed).not.toHaveBeenCalled();
});
