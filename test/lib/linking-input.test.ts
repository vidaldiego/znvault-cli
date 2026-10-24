import {mkdtemp,writeFile,symlink,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {protectedLinkKey} from '../../src/lib/linking.js';
let dir:string|undefined;
afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
describe('protected linking credential input',()=>{
  it('reads an owner-only regular file, rejecting public permissions and symlinks',async()=>{
    dir=await mkdtemp(join(tmpdir(),'znvault-linking-input-'));
    const file=join(dir,'credential'),link=join(dir,'symlink');
    await writeFile(file,'synthetic-linking-key\n',{mode:0o600});
    expect(await protectedLinkKey(file,'unused')).toBe('synthetic-linking-key');
    await symlink(file,link);await expect(protectedLinkKey(link,'unused')).rejects.toThrow();
    await chmod(file,0o644);await expect(protectedLinkKey(file,'unused')).rejects.toThrow('LINKING_PROTECTED_INPUT_REQUIRED');
    await chmod(file,0o600);await writeFile(file,'x'.repeat(257));await expect(protectedLinkKey(file,'unused')).rejects.toThrow('LINKING_PROTECTED_INPUT_REQUIRED');
  });
});
