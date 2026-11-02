import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
// @ts-expect-error acceptance helper is intentionally plain ESM
import {startRecoveryCanary,assertSilentRecoveryWindow} from '../../scripts/recovery-network-canary.mjs';
const connectDuringWindow=(port:number)=>spawnSync(process.execPath,['-e',`const s=require('node:net').connect(${port},'127.0.0.1',()=>s.end('during-window'));s.on('error',()=>process.exit(2));s.on('close',()=>process.exit(0));setTimeout(()=>process.exit(3),2000)`],{timeout:4000});
it('observes a real connection while the parent is synchronously blocked, and rejects that recovery window',async()=>{
 const canary=await startRecoveryCanary();
 try{
  expect(canary.positiveControl).toBe(true);
  await canary.beginWindow();
  expect(connectDuringWindow(canary.port).status).toBe(0);
  const evidence=await canary.endWindow();
  expect(evidence.observedCanaryConnections).toBe(1);
  expect(evidence.observedCanaryBytes).toBe(Buffer.byteLength('during-window'));
  expect(evidence.canaryAliveAfterWindow).toBe(true);
  expect(()=>assertSilentRecoveryWindow(evidence)).toThrow('Recovery window reached network canary');
 }finally{await canary.close();}
});
it('reports a silent measured window with an independently positive-controlled live observer',async()=>{
 const canary=await startRecoveryCanary();
 try{
  await canary.beginWindow();
  spawnSync(process.execPath,['-e','let n=0;for(let i=0;i<1000000;i++)n+=i']);
  const evidence=await canary.endWindow();
  expect(evidence).toMatchObject({observedCanaryConnections:0,observedCanaryBytes:0,canaryAliveAfterWindow:true,canaryPositiveControl:true,canaryPostWindowPositiveControl:true,canaryObservationWindow:'before-first-recovery-command through final-command-exit'});
  expect(evidence.canaryWindowEndedAt).toBeGreaterThanOrEqual(evidence.canaryWindowStartedAt);
  expect(()=>assertSilentRecoveryWindow(evidence)).not.toThrow();
 }finally{await canary.close();}
});
