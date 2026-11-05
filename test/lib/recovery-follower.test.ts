import {describe,it,expect,vi,afterEach} from 'vitest';
const hooks=vi.hoisted(()=>({stub:false,callbacks:[] as Array<(event:string,name:string)=>void>}));
vi.mock('node:fs',async importOriginal=>{const fs=await importOriginal<typeof import('node:fs')>();const {EventEmitter}=await import('node:events');return {...fs,watch:(...args:unknown[])=>{if(!hooks.stub)return (fs.watch as (...args:unknown[])=>unknown)(...args);hooks.callbacks.push(args[1] as (event:string,name:string)=>void);return Object.assign(new EventEmitter(),{close:vi.fn()});}};});
afterEach(()=>{hooks.stub=false;hooks.callbacks=[];});
import {mkdtemp,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {waitForRecoveryOwner} from '../../src/lib/mobile-auth/recovery-follower.js';
describe('recovery file event follower',()=>{
 it('watches before initial read and reconciles atomic config replacement during it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'follower-'));const configPath=join(dir,'config.json'),lockPath=join(dir,'owner.lock');
  await writeFile(configPath,'old');await mkdir(lockPath);
  let initial!:(v:'pending')=>void,observed!:()=>void;const barrier=new Promise<void>(r=>{observed=r;});
  const recheck=vi.fn().mockImplementationOnce(()=>{observed();return new Promise(r=>{initial=r;});}).mockResolvedValue('ready');
  const pending=waitForRecoveryOwner({configPath,lockPath,signal:new AbortController().signal,recheck});await barrier;
  await writeFile(join(dir,'tmp'),'new');await rename(join(dir,'tmp'),configPath);await new Promise(r=>setImmediate(r));initial('pending');await pending;
  expect(recheck).toHaveBeenCalledTimes(2);await rm(dir,{recursive:true,force:true});
 });
 it('ignores unrelated paths and lock heartbeat changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'follower-'));const configPath=join(dir,'config.json'),lockPath=join(dir,'owner.lock');await writeFile(configPath,'old');await mkdir(lockPath);
  hooks.stub=true;const controller=new AbortController();const recheck=vi.fn().mockResolvedValue('pending');const pending=waitForRecoveryOwner({configPath,lockPath,signal:controller.signal,recheck});
  await new Promise(r=>setImmediate(r));for(const event of hooks.callbacks){event('rename','other');event('change','owner.lock');}await new Promise(r=>setImmediate(r));expect(recheck).toHaveBeenCalledTimes(1);
  controller.abort(new Error('cancelled'));await expect(pending).rejects.toThrow('cancelled');await rm(dir,{recursive:true,force:true});
 });
});

it('reports file watch failure as explicit retry before any reads',async()=>{
  const recheck=vi.fn(async()=> 'pending' as const);
  await expect(waitForRecoveryOwner({configPath:'/nonexistent-synthetic-znvault-watch/config.json',lockPath:'/nonexistent-synthetic-znvault-watch/lock',signal:new AbortController().signal,recheck})).rejects.toThrow('file watch failed. Explicitly retry');
  expect(recheck).not.toHaveBeenCalled();
});
