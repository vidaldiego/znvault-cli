#!/usr/bin/env node
// Clean installation prepares dependencies first; recovery itself is OS network denied.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, readJson, tree, verifyIdentity } from './recovery-artifact.mjs';
import { offlineAcceptance } from './recovery-offline-worker.mjs';
const [tarball, candidateFile, fixtureDir] = process.argv.slice(2);
if (![tarball,candidateFile,fixtureDir].every(p=>p&&isAbsolute(p)))throw Error('Require absolute tarball, expected candidate JSON and synthetic fixture directory');
const expected=readJson(candidateFile);
if(!/^[a-f0-9]{40}$/.test(expected.commit??'')||!/^[a-f0-9]{64}$/.test(expected.sha256??'')||digest(readFileSync(tarball))!==expected.sha256)throw Error('Artifact digest/candidate mismatch');
const work=mkdtempSync(join(tmpdir(),'znvault-recovery-package-'));
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
try{
 const entries=run('tar',['-tzf',tarball]).trim().split('\n');
 if(entries.some(e=>!e.startsWith('package/')||e.split('/').some(p=>p==='..'))||run('tar',['-tvzf',tarball]).trim().split('\n').some(l=>!/^[-d]/.test(l)))throw Error('Unsafe package archive');
 const extracted=join(work,'extracted');mkdirSync(extracted);run('tar',['-xzf',tarball,'-C',extracted]);
 await verifyIdentity(join(extracted,'package'),expected);
 const install=join(work,'installed');mkdirSync(install);
 run('npm',['install','--prefix',install,'--ignore-scripts','--no-audit','--no-fund',tarball]);
 const root=join(install,'node_modules/@zincapp/znvault-cli');
 if(JSON.stringify(tree(root))!==JSON.stringify(tree(join(extracted,'package'))))throw Error('Installed package differs from exact archive');
 const options={root,fixtureDir,work:join(work,'acceptance'),expected,launcher:{command:process.execPath,args:[join(root,'dist/index.js')]}};
 let result;
 if(process.platform==='darwin')result=await offlineAcceptance(options);
 else if(process.platform==='linux'){
  const optionsFile=join(work,'options.json');writeFileSync(optionsFile,JSON.stringify(options));
  result=JSON.parse(run('docker',['run','--rm','--network','none','--cpus','1','--memory','1g','--label','com.zincapp.znvault.rehearsal=recovery-package','--mount',`type=bind,src=${work},dst=${work}`,'--mount',`type=bind,src=${fixtureDir},dst=${fixtureDir},readonly`,'--mount',`type=bind,src=${import.meta.dirname},dst=${import.meta.dirname},readonly`,'--mount',`type=bind,src=${process.execPath},dst=${process.execPath},readonly`,'node:24.22.1-bookworm-slim',process.execPath,join(import.meta.dirname,'recovery-offline-worker.mjs'),'--worker',optionsFile]));
 }else throw Error('Unsupported recovery acceptance platform');
 console.log(JSON.stringify({...result,artifactSha256:expected.sha256,installedDependencyLockSha256:digest(readFileSync(join(install,'package-lock.json'))),distribution:'npm tarball plus prepared dependencies'}));
}catch(error){console.error(error.message?.split('\n')[0]??'Package verification failed');process.exitCode=1;}finally{rmSync(work,{recursive:true,force:true});}
