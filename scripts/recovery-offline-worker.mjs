import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { digest, readJson, verifyIdentity } from './recovery-artifact.mjs';
import { copyPreparedFixtures } from './recovery-artifact-fixtures.mjs';
export async function offlineAcceptance({ root, fixtureDir, work, expected, launcher, denied = false }) {
  const identity = await verifyIdentity(root, expected);
  const config = join(work, 'hostile'); mkdirSync(config, { recursive: true });
  const plugin = join(config, 'hostile.mjs'), marker = join(config, 'imported');
  writeFileSync(plugin, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'imported');throw Error('HOSTILE_PLUGIN_MARKER');`);
  writeFileSync(join(config, 'config.json'), JSON.stringify({ activeProfile: 'hostile', profiles: { hostile: { url: 'https://127.0.0.1:1', apiKey: 'HOSTILE_CREDENTIAL_MARKER', accessToken: 'expired', refreshToken: 'HOSTILE_REFRESH_MARKER' } }, plugins: [{ path: plugin, enabled: true }] }));
  const beforeConfig = digest(readFileSync(join(config, 'config.json')));
  const env = { PATH: '/usr/bin:/bin', HOME: work, TMPDIR: work, ZNVAULT_CONFIG_DIR: config, ZNVAULT_URL: 'https://127.0.0.1:1', ZNVAULT_PROFILE: 'hostile', ZNVAULT_API_KEY: 'HOSTILE_CREDENTIAL_MARKER', AWS_EC2_METADATA_SERVICE_ENDPOINT: 'http://169.254.169.254', AWS_PROFILE: 'hostile', DATABASE_URL: 'postgres://hostile:hostile@127.0.0.1:1/hostile' };
  const sandbox = process.platform === 'darwin' ? ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)'] : [];
  if (!sandbox.length && !denied) throw Error('OS network isolation required');
  const wrap = (command, args) => sandbox.length ? { command: sandbox[0], args: [...sandbox.slice(1), command, ...args] } : { command, args };
  let observedCanaryConnections = 0, observedCanaryBytes = 0;
  const canary = createServer(socket => { observedCanaryConnections++; socket.on('data', b => { observedCanaryBytes += b.length; socket.end(); }); });
  await new Promise(r => canary.listen(0, '127.0.0.1', r));
  const port = canary.address().port;
  const control = connect(port, '127.0.0.1', () => control.write('positive-control'));
  await once(control, 'close');
  if (observedCanaryConnections !== 1 || observedCanaryBytes !== 16) throw Error('Network canary positive control failed');
  observedCanaryConnections = 0; observedCanaryBytes = 0;
  const localProbe = wrap(process.execPath, ['-e', `const s=require('node:net').connect(${port},'127.0.0.1');s.once('connect',()=>process.exit(90));s.once('error',e=>process.exit(['EPERM','EACCES'].includes(e.code)?0:91));setTimeout(()=>process.exit(92),2000)`]);
  if (process.platform === 'darwin' && spawnSync(localProbe.command, localProbe.args, {env,timeout:4000}).status !== 0) throw Error('Sandbox canary denial failed');
  canary.close();
  const probe = wrap(process.execPath, ['-e', "const s=require('node:net').connect(443,'198.51.100.1');s.once('connect',()=>process.exit(90));s.once('error',e=>{console.log(e.code);process.exit(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH'].includes(e.code)?0:91)});setTimeout(()=>process.exit(92),2000)"]);
  const probed = spawnSync(probe.command, probe.args, { env, encoding: 'utf8', timeout: 4000 });
  if (probed.status !== 0) throw Error('OS deny probe failed');
  const netTx = () => process.platform === 'linux' ? readFileSync('/proc/net/dev','utf8').split('\n').filter(l=>l.includes(':')).reduce((n,l)=>n+Number(l.split(':')[1].trim().split(/\s+/)[9]),0) : null;
  const beforeTx = netTx();
  const fixtures = copyPreparedFixtures(fixtureDir, join(work, 'fixtures'));
  const markers = [Buffer.from('SYNTHETIC_SQL_MARKER'), Buffer.from('HOSTILE_CREDENTIAL_MARKER'), Buffer.from('HOSTILE_REFRESH_MARKER'), Buffer.from('HOSTILE_PLUGIN_MARKER'), ...fixtures.flatMap(f => [...f.keys.flatMap(k=>[k,Buffer.from(k.toString('hex')),Buffer.from(k.toString('base64'))]), ...f.material.files.map(m=>Buffer.from(m.contentBase64,'base64'))])];
  const checkPublic = text => { const bytes=Buffer.from(text); if(markers.some(m=>m.length>=16&&bytes.includes(m))) throw Error('Private fixture marker leaked'); };
  const invoke = (args, success=true) => {
    const c=wrap(launcher.command,[...launcher.args,...args]); const r=spawnSync(c.command,c.args,{env,cwd:work,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    checkPublic((r.stdout??'')+(r.stderr??''));
    if ((r.status===0)!==success) throw Error(`Offline command outcome mismatch (${success?'positive':'negative'}, ${r.status})`);
    return r;
  };
  const args = (f, mode='extract', output=join(f.dir,'output')) => ['recovery',mode,'--input',join(f.dir,'input.arcn'),'--manifest',join(f.dir,'manifest.json'),'--expect',join(f.dir,'selection.json'),'--companion-input',join(f.dir,'companion.enc'),'--key-file',join(f.dir,'key-0'),'--key-file',join(f.dir,'key-1'),...(mode==='extract'?['--output',output]:[]),'--json','--debug'];
  let positives=0, negatives=0;
  for(const f of fixtures) {
    const immutable = Object.fromEntries(['input.arcn','companion.enc','manifest.json','selection.json','key-0','key-1'].map(n=>[n,digest(readFileSync(join(f.dir,n)))]));
    invoke(args(f,'verify')); if(existsSync(join(f.dir,'output'))) throw Error('Verify published output');
    invoke(args(f)); positives+=2;
    const recoveredBytes=readFileSync(join(f.dir,'output/content/database.sql')),fixtureBytes=f.plain;
    if(!recoveredBytes.equals(fixtureBytes)) throw Error('Recovered SQL differs');
    for(const m of f.material.files) if(!readFileSync(join(f.dir,'output/content/companion',m.name)).equals(Buffer.from(m.contentBase64,'base64')))throw Error('Recovered companion differs');
    checkPublic(readFileSync(join(f.dir,'output/content/recovery-receipt.json'),'utf8'));
    invoke(args(f),false); negatives++;
    if(!isDeepStrictEqual(immutable,Object.fromEntries(Object.keys(immutable).map(n=>[n,digest(readFileSync(join(f.dir,n)))]))))throw Error('Immutable input changed');
  }
  const f=fixtures[0];
  for(const kind of ['wrong-key','corruption','unknown-format','valid-set-replay','last-companion']){
    const path=join(f.dir,kind==='wrong-key'?'key-0':kind==='corruption'?'input.arcn':kind==='last-companion'?'companion.enc':kind==='valid-set-replay'?'selection.json':'manifest.json');
    const original=readFileSync(path);let changed=Buffer.from(original);
    if(kind==='wrong-key')changed=Buffer.alloc(32,99);
    else if(kind==='valid-set-replay')changed=readFileSync(join(fixtures[1].dir,'selection.json'));
    else if(kind==='unknown-format'){const m=JSON.parse(original);m.manifestVersion=999;changed=Buffer.from(JSON.stringify(m));}
    else changed[changed.length-1]^=1;
    const originalSelection=readFileSync(join(f.dir,'selection.json'));
    if(kind==='unknown-format'){const selection=JSON.parse(originalSelection);selection.metadata.sha256=digest(changed);selection.metadata.bytes=changed.length;writeFileSync(join(f.dir,'selection.json'),JSON.stringify(selection));}
    writeFileSync(path,changed);const output=join(f.dir,kind);
    try{invoke(args(f,'extract',output),false);negatives++;if(existsSync(output)&&readdirSync(output).length)throw Error('Failure left partial output');}finally{writeFileSync(path,original);writeFileSync(join(f.dir,'selection.json'),originalSelection);}
  }
  // Cancel an actual installed CLI while its private input snapshot is being copied.
  const cancelDir=join(work,'cancel');mkdirSync(cancelDir,{mode:0o700});
  const {encryptStream}=await import(pathToFileURL(join(root,'dist/vendor/archon-recovery-core/index.js')).href);
  const chunks=[];
  await encryptStream({input:Readable.from((function*(){for(let i=0;i<128;i++)yield Buffer.alloc(1024*1024,65);})()),output:new Writable({write(b,_,cb){chunks.push(Buffer.from(b));cb();}}),dek:Buffer.alloc(32,9)});
  const encrypted=Buffer.concat(chunks), manifest=readJson(join(f.dir,'manifest.json'));
  manifest.artifactSize=encrypted.length;manifest.encryptedChecksum=digest(encrypted);delete manifest.recoveryCompanion;
  const metadata=Buffer.from(JSON.stringify(manifest)),selection=readJson(join(f.dir,'selection.json'));
  selection.metadata={kind:'manifest',sha256:digest(metadata),bytes:metadata.length};selection.keyBindings=selection.keyBindings.slice(0,1);
  writeFileSync(join(cancelDir,'input.arcn'),encrypted);writeFileSync(join(cancelDir,'manifest.json'),metadata);writeFileSync(join(cancelDir,'selection.json'),JSON.stringify(selection));
  const output=join(cancelDir,'output');const command=wrap(launcher.command,[...launcher.args,'recovery','extract','--input',join(cancelDir,'input.arcn'),'--manifest',join(cancelDir,'manifest.json'),'--expect',join(cancelDir,'selection.json'),'--key-file',join(f.dir,'key-0'),'--output',output,'--json']);
  const child=spawn(command.command,command.args,{env,cwd:work,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);
  const exited=once(child,'exit');let killed=false;
  const poll=setInterval(()=>{if(existsSync(output)&&readdirSync(output).some(n=>n.startsWith('.staging-'))){killed=child.kill('SIGTERM');clearInterval(poll);}},1);
  const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);const [code]=await exited;clearInterval(poll);clearTimeout(timeout);checkPublic(text);
  if(!killed||code===0||(existsSync(output)&&readdirSync(output).length))throw Error('Cancellation did not clean private output');negatives++;
  if(existsSync(marker)||digest(readFileSync(join(config,'config.json')))!==beforeConfig)throw Error('Offline bootstrap touched hostile config/plugins');
  const outboundPackets=beforeTx===null?null:netTx()-beforeTx;
  if(outboundPackets!==null&&outboundPackets!==0)throw Error('Outbound packets observed');
  return {...identity,observedCanaryConnections,observedCanaryBytes,canaryPositiveControl:true,enforcedPolicy:true,rawPacketMeasurement:beforeTx===null?null:'proc-net-dev-tx-packets',platform:process.platform,arch:process.arch,runtime:process.version,positives,negatives,networkDenyProbe:probed.stdout.trim(),outboundPackets,networkIsolation:process.platform==='darwin'?'sandbox-exec deny network*':'docker network none',ciphertext:fixtures.map(f=>f.ciphertext)};
}
if(process.argv[2]==='--worker'){
  const options=readJson(process.argv[3]);
  try{console.log(JSON.stringify(await offlineAcceptance({...options,denied:true})));}catch(error){console.error(error.message);process.exitCode=1;}
}
