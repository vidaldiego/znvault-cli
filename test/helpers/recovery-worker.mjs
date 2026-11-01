// Synthetic subprocess harness only; no runtime test hooks.
import { readFile, writeFile, open } from 'node:fs/promises';
import { createWriteStream, openSync, writeSync, closeSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, mode, dir] = process.argv.slice(2);
const core = await import(pathToFileURL(join(root,'dist/vendor/archon-recovery-core/index.js')));
const { recoverSet } = await import(pathToFileURL(join(root,'dist/lib/recovery/recover.js')));
const { localInputs } = await import(pathToFileURL(join(root,'dist/lib/recovery/storage.js')));
const { loadKeyFiles } = await import(pathToFileURL(join(root,'dist/lib/recovery/protected-files.js')));
const sha = b => createHash('sha256').update(b).digest('hex');
if (mode === 'prepare-large') {
 const path = join(dir,'large.arcn'), fd = openSync(path,'wx',0o600);
 try { await core.encryptStream({ input:Readable.from((async function*(){ for(let i=0;i<4096;i++) yield Buffer.alloc(65536, i%251); })()), output:new Writable({write(b,_e,cb){writeSync(fd,b); cb();}}),dek:Buffer.alloc(32,9) }); } finally {closeSync(fd);}
 const f = await open(path); const size=(await f.stat()).size; const hash=createHash('sha256'); for await (const c of f.createReadStream()) hash.update(c); await f.close();
 const key=Buffer.alloc(32,6),fp=core.computeKeyFingerprint(key);
 const manifest=Buffer.from(JSON.stringify({manifestVersion:2,backupId:43,serviceName:'Vault',storageKey:'dump.enc',versionId:'memory-v1',wrappedDek:core.wrapDekHex(Buffer.alloc(32,9),key),wrappingKeyFingerprint:fp,compression:'none',artifactSize:size,artifactEtag:null,dumpChecksum:null,encryptedChecksum:hash.digest('hex')}));
 const expected={format:'znvault-backup-selection-v1',sourceNamespace:'synthetic-memory',installationUuid:null,serviceName:'Vault',backupId:43,metadata:{kind:'manifest',sha256:sha(manifest),bytes:manifest.length},keyBindings:[{fingerprint:fp,key:{kind:'archon-kek-fingerprint-v1',fingerprint:fp,algorithm:'aes-256-gcm'}}]};
 await writeFile(join(dir,'manifest.json'),manifest);await writeFile(join(dir,'selection.json'),JSON.stringify(expected));await writeFile(join(dir,'key-0'),key,{mode:0o600}); process.exit(0);
}
const expected=JSON.parse(await readFile(join(dir,'selection.json'),'utf8'));
const set=core.verifyRecoverySet(expected,await readFile(join(dir,'manifest.json')));
const keys=await loadKeyFiles(set.components.map((_,i)=>join(dir,`key-${i}`)),set);
const start=process.memoryUsage().rss;let peak=start;const monitor=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},2);
const base=localInputs({dump:join(dir,mode==='memory'?'large.arcn':'input.arcn'),companion:join(dir,'companion.enc')});
const inputs=mode==='pause-companion'?{async *open(c,s){if(c.role==='companion'){process.send?.({ready:true});await new Promise(()=>{});}yield*base.open(c,s);}}:base;
try { const result=await recoverSet(set,inputs,keys.get,{mode:'extract',output:join(dir,'output')});peak=Math.max(peak,process.memoryUsage().rss);console.log(JSON.stringify({authenticated:result.authenticated,baselineRss:start,peakRss:peak,deltaRss:peak-start,maxRssKiB:process.resourceUsage().maxRSS})); }
catch {process.exitCode=1;console.error('synthetic_recovery_failed');}
finally {clearInterval(monitor);keys.dispose();}
