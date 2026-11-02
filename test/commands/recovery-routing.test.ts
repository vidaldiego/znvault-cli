import {expect,it} from 'vitest';
import {selectAssistedRecovery} from '../../src/commands/recovery/bootstrap.js';
it('requires explicit unambiguous native source and selector before connected imports',()=>{
 expect(selectAssistedRecovery(['--profile','offsite','recovery','verify','--key-source','vault','--backup','id'])).toBe(true);
 expect(selectAssistedRecovery(['recovery','verify','--expect','custodied','--key-file','local'])).toBe(false);
 for(const args of [
 ['--profile','offsite','recovery','verify','--key-source','vault','--key-file','local','--expect','file'],
 ['--profile','offsite','recovery','verify','--key-source','vault','--expect','file','--backup','id'],
 ['recovery','verify','--key-source','vault','--backup','id'],
 ['--profile','offsite','recovery','verify','--key-source','vault','--backup','id','--url','https://evil.invalid'],
 ['--profile','offsite','--profile','main','recovery','verify','--key-source','vault','--backup','id'],
 ])expect(()=>selectAssistedRecovery(args)).toThrow();
});
