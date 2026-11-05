import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

const owned:string[]=[];
afterEach(()=>{for(const path of owned.splice(0))rmSync(path,{recursive:true,force:true});});

function verify(version:string,operationId:boolean){
  const root=mkdtempSync(join(tmpdir(),'znvault-public-package-'));owned.push(root);
  const packageRoot=join(root,'package');mkdirSync(join(packageRoot,'dist/vendor/archon-recovery-core'),{recursive:true});
  writeFileSync(join(packageRoot,'package.json'),JSON.stringify({name:'@zincapp/znvault-cli',version,type:'module'}));
  for(const file of ['index.js','arcn-stream.js','companion.js','selection.js','provenance.js']){
    writeFileSync(join(packageRoot,'dist/vendor/archon-recovery-core',file),'// public synthetic presence fixture\n');
  }
  const commands=['status','enable','disable','verify','restore','preflight','grants','grant','revoke','recover',
    'recover-grant','protection','replication','create','list','test','sync','pause','resume','consent','revoke-local','stop'];
  const help=['Usage: synthetic CLI','--qr --web --recover --remember-iphone --expected-epoch --version <number> --link <name-or-id> lookup',
    ...commands.map(command=>'  '+command+' synthetic public help'),...(operationId?['--operation-id <uuid>']:[])].join('\n');
  // Real subprocess/package verifier; this fixture has no network or credential API.
  writeFileSync(join(packageRoot,'dist/index.js'),
    'const args=process.argv.slice(2);console.log(args.includes("--version")&&!args.includes("--help")?'+JSON.stringify(version)+':'+JSON.stringify(help)+');\n');
  const tarball=join(root,'public.tgz');execFileSync('tar',['-czf',tarball,'-C',root,'package']);
  const npmrc=join(root,'empty-npmrc');writeFileSync(npmrc,'');
  return spawnSync(process.execPath,[resolve('scripts/verify-package.mjs'),tarball,version],{
    encoding:'utf8',timeout:20_000,env:{...process.env,CI:'1',NPM_CONFIG_USERCONFIG:npmrc,
      NPM_CONFIG_CACHE:join(root,'npm-cache'),NPM_CONFIG_REGISTRY:'http://127.0.0.1:9'},
  });
}

describe('published package Root Key compatibility',()=>{
  it('accepts published CLI 7.0 without the later Trust Root UUID option',()=>{
    const result=verify('7.0.0',false);expect(result.status,result.stderr).toBe(0);
  });
  it('requires the UUID option for the first Trust Root CLI candidate',()=>{
    const result=verify('7.1.0',false);expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Trust Root stable operation UUID surface missing');
  });
  it('verifies the new option together with the retained command surfaces',()=>{
    const result=verify('7.1.0',true);expect(result.status,result.stderr).toBe(0);
  });
});
