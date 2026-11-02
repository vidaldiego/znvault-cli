// Independent event loop: synchronous recovery subprocesses must not stop observation.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

if (!isMainThread && workerData?.recoveryCanary) {
  let connections=0,bytes=0,window=null;
  const server=createServer(socket=>{
    connections++;if(window)window.connections++;
    socket.on('data',data=>{bytes+=data.length;if(window)window.bytes+=data.length;socket.end();});
    socket.on('error',()=>{});
  });
  server.listen(0,'127.0.0.1',()=>parentPort.postMessage({ready:true,port:server.address().port}));
  parentPort.on('message',async({id,command})=>{
    if(command==='begin')window={connections:0,bytes:0,startedAt:Date.now()};
    // Commands have exited. Drain already queued socket events before the final snapshot.
    if(command==='end')await new Promise(resolve=>setTimeout(resolve,50));
    const result={connections,bytes,alive:server.listening,...(window?{window:{...window,endedAt:Date.now()}}:{})};
    if(command==='end')window=null;
    parentPort.postMessage({id,result});
  });
}

export function assertSilentRecoveryWindow(evidence){
  if(!evidence.canaryAliveAfterWindow||!evidence.canaryPositiveControl||!evidence.canaryPostWindowPositiveControl)throw Error('Network canary observation unavailable');
  if(evidence.observedCanaryConnections!==0||evidence.observedCanaryBytes!==0)throw Error('Recovery window reached network canary');
}

export async function startRecoveryCanary(){
  const worker=new Worker(new URL(import.meta.url),{workerData:{recoveryCanary:true}});
  const pending=new Map();let sequence=0;
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  worker.on('message',message=>{if(message.ready)readyResolve(message.port);else pending.get(message.id)?.resolve(message.result);});
  const failed=()=>{readyReject(Error('Network canary observer failed'));for(const request of pending.values())request.reject(Error('Network canary observer failed'));};
  worker.on('error',failed);worker.on('exit',failed);
  const rpc=command=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Network canary observer timeout'));},4000);
    const finish=fn=>value=>{clearTimeout(timer);pending.delete(id);fn(value);};
    pending.set(id,{resolve:finish(resolve),reject:finish(reject)});worker.postMessage({id,command});
  });
  try{
    const port=await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Network canary startup timeout')),4000);timer.unref();})]);
    const positive=async()=>{
      const before=await rpc('snapshot');
      const result=spawnSync(process.execPath,['-e',`const s=require('node:net').connect(${port},'127.0.0.1',()=>s.end('positive-control'));s.on('error',()=>process.exit(2));s.on('close',()=>process.exit(0));setTimeout(()=>process.exit(3),2000)`],{timeout:4000,stdio:'ignore'});
      const after=await rpc('snapshot');
      if(result.status!==0||!after.alive||after.connections-before.connections!==1||after.bytes-before.bytes!==16)throw Error('Network canary positive control failed');
      return true;
    };
    await positive();let begun=false,ended=false;
    return {port,positiveControl:true,
      async beginWindow(){if(begun)throw Error('Canary window already started');begun=true;await rpc('begin');},
      async endWindow(){
        if(!begun||ended)throw Error('Canary window is not active');ended=true;
        const final=await rpc('end');const post=await positive();
        return {canaryAddress:'127.0.0.1',canaryPort:port,observedCanaryConnections:final.window.connections,observedCanaryBytes:final.window.bytes,canaryAliveAfterWindow:final.alive,canaryPositiveControl:true,canaryPostWindowPositiveControl:post,canaryObservationWindow:'before-first-recovery-command through final-command-exit',canaryWindowStartedAt:final.window.startedAt,canaryWindowEndedAt:final.window.endedAt};
      },
      close:()=>worker.terminate(),
    };
  }catch(error){await worker.terminate();throw error;}
}
