import { afterEach, expect, it } from 'vitest';
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../helpers/recovery-fixture.js';
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'recovery-files-')); dirs.push(d); return d; };
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
it('resolves two exact fingerprints once and rejects missing duplicate and unused files before unwrap', async () => {
  const f = await fixture(temp(), { companion: true });
  const { loadKeyFiles } = await import('../../src/lib/recovery/protected-files.js');
  const provider = await loadKeyFiles(f.keyFiles, f.set);
  const result = await provider.get(f.set.components[1].key, new AbortController().signal);
  expect(result).toEqual(Buffer.alloc(32, 7)); provider.dispose(); expect(result).toEqual(Buffer.alloc(32));
  await expect(loadKeyFiles(f.keyFiles.slice(0, 1), f.set)).rejects.toThrow();
  await expect(loadKeyFiles([f.keyFiles[0], f.keyFiles[0]], f.set)).rejects.toThrow();
  const extra = join(temp(), 'extra'); writeFileSync(extra, Buffer.alloc(32, 99), { mode: 0o600 });
  await expect(loadKeyFiles([...f.keyFiles, extra], f.set)).rejects.toThrow();
  expect(readFileSync(f.keyFiles[0])).toEqual(Buffer.alloc(32, 6));
});
it.each(['permissions','symlink','hardlink','pipe','directory','oversize'])('refuses unsafe key file %s without mutating operator files', async kind => {
  const d = temp(); const f = await fixture(d); const original = f.keyFiles[0]; let path = original;
  if (kind === 'permissions') chmodSync(original, 0o644);
  if (kind === 'symlink') { path = join(d, 'link'); symlinkSync(original, path); }
  if (kind === 'hardlink') { path = join(d, 'link'); linkSync(original, path); }
  if (kind === 'pipe') { path = join(d, 'pipe'); execFileSync('mkfifo', [path]); }
  if (kind === 'directory') path = d;
  if (kind === 'oversize') writeFileSync(original, Buffer.alloc(4097));
  const { loadKeyFiles } = await import('../../src/lib/recovery/protected-files.js');
  await expect(loadKeyFiles([path], f.set)).rejects.toThrow(); expect(existsSync(original)).toBe(true);
});
it('never replaces an existing operator output or follows its symlink', async()=>{
 const d=temp(),f=await fixture(d),operator=join(d,'operator');writeFileSync(operator,'keep');const output=join(d,'output');symlinkSync(operator,output);
 const {recoverSet}=await import('../../src/lib/recovery/recover.js');const {localInputs}=await import('../../src/lib/recovery/storage.js');
 await expect(recoverSet(f.set,localInputs(f.paths),async()=>f.keys[0],{mode:'extract',output})).rejects.toThrow();expect(readFileSync(operator,'utf8')).toBe('keep');
});
