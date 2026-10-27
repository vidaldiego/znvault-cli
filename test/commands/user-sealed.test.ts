import {Command} from 'commander';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Readable} from 'node:stream';
import {registerUserSealedCommands, readApprovalCode} from '../../src/commands/user-sealed.js';
import * as approvals from '../../src/lib/session-approval.js';
import * as config from '../../src/lib/config.js';
import * as prompts from '../../src/lib/prompts.js';

vi.mock('../../src/lib/session-approval.js',()=>({
  withApprovalSession:vi.fn(async callback=>await callback({})),
  approveWithIPhone:vi.fn(async()=>({approval:{approved:true}})),
  approveWithTOTP:vi.fn(async(_session,_kind,reader)=>{await reader();return {approval:{approved:true}};}),
  getApprovalStatus:vi.fn(async()=>({unlocked:true,approval:{approved:false}})),
  closeUserSealedAccess:vi.fn(async()=>({approval:{approved:false}})),
}));
vi.mock('../../src/lib/prompts.js',()=>({promptPassword:vi.fn(async()=>'123456')}));
let program:Command;
beforeEach(()=>{program=new Command();program.exitOverride();registerUserSealedCommands(program);process.exitCode=undefined;vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();process.exitCode=undefined;});

it.each([[],['--iphone','--otp'],['--iphone-device','phone']].map(flags=>({flags})))('requires exactly one explicit factor: $flags',async ({flags})=>{
  await program.parseAsync(['node','test','user-sealed','approve','--json',...flags]);
  expect(process.exitCode).toBe(1);expect(approvals.withApprovalSession).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SESSION_APPROVAL_METHOD_REQUIRED'));
});
it('uses the selected phone and emits one JSON result without prompting for a seed',async()=>{
  const seed=vi.spyOn(config,'generateTOTPCode');
  await program.parseAsync(['node','test','user-sealed','approve','--iphone','--iphone-device','phone','--json']);
  expect(approvals.approveWithIPhone).toHaveBeenCalledWith({},'user-sealed',expect.objectContaining({deviceId:'phone',signal:expect.any(AbortSignal)}));
  expect(console.log).toHaveBeenCalledTimes(1);expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({approval:{approved:true}});
  expect(seed).not.toHaveBeenCalled();expect(prompts.promptPassword).not.toHaveBeenCalled();
});
it('does not prompt implicitly in a noninteractive OTP invocation',async()=>{
  Object.defineProperty(process.stdin,'isTTY',{configurable:true,value:false});
  await program.parseAsync(['node','test','user-sealed','approve','--otp','--json']);
  expect(process.exitCode).toBe(1);expect(prompts.promptPassword).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SESSION_APPROVAL_OTP_STDIN_REQUIRED'));
});
it('status and close are explicit actions without a factor prompt',async()=>{
  await program.parseAsync(['node','test','user-sealed','status','--json']);
  expect(approvals.getApprovalStatus).toHaveBeenCalledWith({},'user-sealed');
  program=new Command();registerUserSealedCommands(program);
  await program.parseAsync(['node','test','user-sealed','close','--json']);
  expect(approvals.closeUserSealedAccess).toHaveBeenCalledTimes(1);expect(prompts.promptPassword).not.toHaveBeenCalled();
});
it('SIGINT aborts the pending phone request and removes its handler',async()=>{
  const before=process.listenerCount('SIGINT');
  vi.mocked(approvals.approveWithIPhone).mockImplementationOnce(async(_s,_kind,options)=>{
    process.emit('SIGINT');expect(options.signal?.aborted).toBe(true);options.signal?.throwIfAborted();throw new Error('unreachable');
  });
  await program.parseAsync(['node','test','user-sealed','approve','--iphone','--json']);
  expect(process.exitCode).toBe(1);expect(process.listenerCount('SIGINT')).toBe(before);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SESSION_APPROVAL_CANCELLED'));
});
it('accepts only one bounded six-digit code from explicitly selected stdin',async()=>{
  expect(await readApprovalCode(true,Readable.from(['123456\n']))).toBe('123456');
  await expect(readApprovalCode(true,Readable.from(['123456\n987654\n']))).rejects.toThrow('SESSION_APPROVAL_INVALID_TOTP');
  await expect(readApprovalCode(true,Readable.from(['1'.repeat(65)]))).rejects.toThrow('SESSION_APPROVAL_INVALID_TOTP');
});
