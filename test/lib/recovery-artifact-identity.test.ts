import {expect,it,afterEach} from 'vitest';
import {mkdtempSync,cpSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
// The acceptance module reads actual on-disk candidate bytes, never a mocked importer.
// @ts-expect-error JS acceptance harness has no TypeScript declaration.
import {tree,digest,verifyIdentity} from '../../scripts/recovery-artifact.mjs';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
it('rejects actual missing/tampered compiled snapshot, wrong CLI version, commit, lock and source provenance',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-identity-'));dirs.push(root);
 cpSync(resolve('dist'),join(root,'dist'),{recursive:true});rmSync(join(root,'dist/recovery-build.json'),{force:true});
 cpSync(resolve('src/vendor/archon-recovery-core'),join(root,'dist/recovery-source'),{recursive:true});
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',version:'5.8.1'}));
 const original=readFileSync(resolve('src/vendor/archon-recovery-core/SOURCE-PROVENANCE.json'));
 const expected={packageSha256:digest(readFileSync(join(root,'package.json'))),version:'5.8.1',commit:'1'.repeat(40),lockSha256:'2'.repeat(64),sourceSha:'7a6cf89dff25cdb2dbb82441fca7b0d6f4c6ef31',exportSha256:digest(original)};
 writeFileSync(join(root,'dist/recovery-build.json'),JSON.stringify({commit:expected.commit,lockSha256:expected.lockSha256,files:tree(join(root,'dist'))}));
 await expect(verifyIdentity(root,expected)).resolves.toMatchObject({installedSourceCommit:expected.commit});
 for(const override of [{version:'0.0.0'},{commit:'3'.repeat(40)},{lockSha256:'4'.repeat(64)},{sourceSha:'5'.repeat(40)}])await expect(verifyIdentity(root,{...expected,...override})).rejects.toThrow(/mismatch/);
 const file=join(root,'dist/vendor/archon-recovery-core/arcn-stream.js');writeFileSync(file,'throw Error("tampered");');
 await expect(verifyIdentity(root,expected)).rejects.toThrow('compiled artifact digest mismatch');
 rmSync(file);await expect(verifyIdentity(root,expected)).rejects.toThrow('compiled artifact digest mismatch');
});
