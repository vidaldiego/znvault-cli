import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {observeMobileStatus,parseMobileWaitEvents,type MobileWaitEvent} from '../../src/lib/mobile-auth/mobile-auth-wait.js';
function channel() {
 const queued: MobileWaitEvent[]=[]; let wake: (()=>void)|undefined;let ended=false;
 return {push(value:MobileWaitEvent){queued.push(value);wake?.();},close(){ended=true;wake?.();},async *events(){while(!ended||queued.length){if(queued.length)yield queued.shift()!;else await new Promise<void>(r=>{wake=r;});}}};
}
const hint=(revision:string):MobileWaitEvent=>({type:'changed',version:1,requestId:'attempt',revision});
describe('portable mobile wait',()=>{
 it('reads only initial and changed hints, coalesces duplicates and stays idle',async()=>{
  vi.useFakeTimers();const c=channel(), read=vi.fn(async()=>({state:'pending'}));const controller=new AbortController();
  const wait=observeMobileStatus({requestId:'attempt',expiresAt:Date.now()+120000,signal:controller.signal,openEvents:()=>c.events(),readStatus:read});
  const first=wait.next();await vi.advanceTimersByTimeAsync(90000);expect(read).toHaveBeenCalledTimes(0);
  c.push(hint('1'));expect((await first).value).toEqual({state:'pending'});c.push(hint('1'));
  const next=wait.next();await vi.advanceTimersByTimeAsync(1000);expect(read).toHaveBeenCalledTimes(1);
  c.push(hint('2'));await next;expect(read).toHaveBeenCalledTimes(2);c.close();await expect(wait.next()).rejects.toThrow('DISCONNECTED');vi.useRealTimers();
 });
 it('acks only the revision captured before read and drains higher hints after disconnect',async()=>{
  const c=channel();let finish!:(v:string)=>void;const read=vi.fn().mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;})).mockResolvedValue('fresh');
  const wait=observeMobileStatus({requestId:'attempt',expiresAt:Date.now()+120000,signal:new AbortController().signal,openEvents:()=>c.events(),readStatus:read});
  const first=wait.next();c.push(hint('1'));await new Promise(r=>setImmediate(r));c.push(hint('2'));c.close();finish('old');expect((await first).value).toBe('old');expect((await wait.next()).value).toBe('fresh');expect(read).toHaveBeenCalledTimes(2);await expect(wait.next()).rejects.toThrow('DISCONNECTED');
 });
 it('rejects malformed, oversized and wrong-attempt frames',async()=>{
  for(const frame of ['event: changed\nid: 1\ndata: {}\n\n','x'.repeat(16385), 'event: changed\nid: 1\ndata: {"version":1,"requestId":"other","revision":"1"}\n\n']){
   await expect((async()=>{for await(const _ of parseMobileWaitEvents((async function*(){yield frame;})(),'attempt'))void _;})()).rejects.toThrow();
  }
 });
 it('parses split utf8, comments and decimal-string cursor',async()=>{
  const frame=': alive\n\nevent: changed\nid: 9007199254740993\ndata: {"version":1,"requestId":"attempt","revision":"9007199254740993"}\n\n';
  const values=[];for await(const e of parseMobileWaitEvents((async function*(){for(const b of new TextEncoder().encode(frame))yield new Uint8Array([b]);})(),'attempt'))values.push(e);
  expect(values).toEqual([hint('9007199254740993')]);
 });
});

describe('portable v1 wire fixtures',()=>{
 it('accepts valid fixtures and rejects invalid frames',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/mobile-auth-wait/v1.json',import.meta.url),'utf8'));
  const decode=async(wire:string)=>{const values=[];for await(const e of parseMobileWaitEvents((async function*(){yield wire;})(),fixture.requestId))values.push(e);return values;};
  for(const item of fixture.valid)expect(await decode(item.wire)).toEqual([item.event]);
  for(const wire of fixture.invalid)await expect(decode(wire)).rejects.toThrow('INVALID');
 });
 it('does not read unchanged cursor on reconnect and acknowledges only successful reads',async()=>{
  const reads=vi.fn(async()=> 'new');const ack=vi.fn();
  const unchanged=observeMobileStatus({requestId:'attempt',expiresAt:Date.now()+120000,signal:new AbortController().signal,afterRevision:'5',onRevision:ack,readStatus:reads,openEvents:async function*(cursor){expect(cursor).toBe('5');yield hint('5');}});
  await expect(unchanged.next()).rejects.toThrow('DISCONNECTED');expect(reads).not.toHaveBeenCalled();expect(ack).not.toHaveBeenCalled();
  const changed=observeMobileStatus({requestId:'attempt',expiresAt:Date.now()+120000,signal:new AbortController().signal,afterRevision:'5',onRevision:ack,readStatus:reads,openEvents:async function*(){yield hint('6');}});
  expect((await changed.next()).value).toBe('new');expect(ack).toHaveBeenCalledWith('6');await changed.return();
 });
});
