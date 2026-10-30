import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
const root = resolve(__dirname, '../..'), worker = join(root, 'test/fixtures/profile-auth-worker.mjs');
let directory: string;
let children: ChildProcess[] = [];
function data() {return JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));}
function launch(mode: string) {
  const child = spawn(process.execPath, [worker, directory, 'remembered', mode], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  children.push(child);
  const phases = new Map<string, () => void>(), received = new Set<string>();
  child.on('message', (message: {phase?: string}) => {if (message.phase) {received.add(message.phase);phases.get(message.phase)?.();}});
  let stdout = '', stderr = '';
  child.stdout!.setEncoding('utf8').on('data', x => {stdout += x;});child.stderr!.setEncoding('utf8').on('data', x => {stderr += x;});
  const done = new Promise<{status:number|null; output:string; error:string}>((resolveRun, reject) => {
    child.on('error', reject);child.on('exit', status => {resolveRun({status, output:stdout, error:stderr});});
  });
  return {child, done, wait: async (phase: string) => {
    if (!received.has(phase)) await Promise.race([new Promise<void>(resolvePhase => {phases.set(phase, resolvePhase);}),
      done.then(result => {throw new Error('Test worker ended before its barrier: '+result.status);})]);
  }};
}
beforeAll(() => {execFileSync('npm', ['run','build'], {cwd: root, stdio:'pipe'});}, 180000);
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'znvault-recovery-crossproc-'));children = [];
  const cliRecovery = {state:'active', grantId:randomUUID(), credential:randomBytes(32).toString('base64url'), origin:'https://vault.example.test',
    installationId:randomUUID(), expiresAtSec:Math.floor(Date.now()/1000)+2592000};
  writeFileSync(join(directory,'config.json'), JSON.stringify({activeProfile:'remembered', profiles:{remembered:{url:cliRecovery.origin,insecure:false,timeout:1000,
    authGeneration:randomUUID(),cliRecovery, credentials:{accessToken:'test-access-token',refreshToken:'test-refresh-token',expiresAt:1,
      userId:'test-user',username:'test-user',role:'user',tenantId:'test-tenant'}}, neighbor:{url:'https://other.example.test',insecure:false,timeout:1000}}, plugins:[]}), {mode:0o600});
});
afterEach(() => {for(const child of children) if(child.exitCode === null) child.kill();rmSync(directory,{recursive:true,force:true});});
describe('real profile-store processes share one authentication generation', () => {
  it('keeps an in-flight URL change on its initiating profile when another process switches active profile', async () => {
    const old = data(), changing = launch('config-url');await changing.wait('retire-sent');
    execFileSync(process.execPath,[join(root,'test/fixtures/profile-store-writer.mjs'),directory,'switch','remembered','neighbor'],{stdio:'pipe'});
    expect(data().activeProfile).toBe('neighbor');
    changing.child.send({continue:true});expect((await changing.done).status).toBe(0);
    const final = data();expect(final.profiles.remembered.url).toBe('https://changed.example.test');
    expect(final.profiles.neighbor).toEqual(old.profiles.neighbor);
  },20000);

  it.each(['retire','delete-recreate'])('a late recovery cannot resurrect credentials after %s', async mode => {
    const old = data(), recovering = launch('recover');await recovering.wait('before-complete');
    expect((await launch(mode).done).status).toBe(0);
    recovering.child.send({continue:true});
    expect((await recovering.done).status).toBe(1);
    const final = data();expect(final.profiles.remembered.credentials).toBeUndefined();expect(final.profiles.remembered.cliRecovery).toBeUndefined();
    expect(final.profiles.neighbor).toEqual(old.profiles.neighbor);
    expect(statSync(join(directory,'config.json')).mode &0o777).toBe(0o600);
  }, 20000);
  it.each([false,true])('a late ordinary refresh cannot overwrite recovery (refresh returns first=%s)', async first => {
    const original = data(), refreshing = launch('refresh');await refreshing.wait('refresh-sent');
    const recovering = launch('recover');await recovering.wait('before-complete');
    if(first) {refreshing.child.send({continue:true});expect((await refreshing.done).status).toBe(1);}
    recovering.child.send({continue:true});expect((await recovering.done).status).toBe(0);
    if(!first) {refreshing.child.send({continue:true});expect((await refreshing.done).status).toBe(1);}
    const final = data();expect(final.profiles.remembered.credentials.accessToken).toBe('recovery-access-token');
    expect(final.profiles.remembered.cliRecovery).toEqual(original.profiles.remembered.cliRecovery);
    expect(final.profiles.neighbor).toEqual(original.profiles.neighbor);
  }, 20000);
});
