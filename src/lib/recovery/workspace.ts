import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rmdir, statfs, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { trustedParent, trustedTemporaryAncestor } from './protected-files.js';

function identity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode && a.isDirectory() === b.isDirectory();
}
export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Owns only its exclusive empty reservation. Never adopts or recursively removes replacements. */
export class TemporaryReservation {
  private constructor(readonly path: string, private readonly parent: string,
    private readonly parentStat: BigIntStats, private readonly ownStat: BigIntStats) {}
  static async reserve(ancestor: string): Promise<TemporaryReservation> {
    const parent = await trustedTemporaryAncestor(ancestor);
    const before = await lstat(parent, {bigint:true});
    const path = await mkdtemp(join(parent, 'znvault-recovery-'));
    const reservation = new TemporaryReservation(path, parent, before, await lstat(path, {bigint:true}));
    try { await reservation.assertOwned(); return reservation; }
    catch (error) { await reservation.cleanup(); throw error; }
  }
  private async assertOwned(): Promise<void> {
    await trustedTemporaryAncestor(this.parent);
    if (!identity(this.parentStat, await lstat(this.parent, {bigint:true})) ||
        !identity(this.ownStat, await lstat(this.path, {bigint:true})) ||
        this.ownStat.uid !== BigInt(process.getuid?.() ?? -1) || (this.ownStat.mode & 0o077n) !== 0n) {
      throw Error('recovery_workspace_changed');
    }
    await trustedParent(this.path);
  }
  async cleanup(): Promise<boolean> {
    try { await this.assertOwned(); await rmdir(this.path); return true; }
    catch { return false; }
  }
}

/** Every removal/publication uses a recorded inode; never recursively remove a
 * pathname whose contents or ancestry may have been replaced by another actor. */
export class Workspace {
  private readonly owned = new Map<string, BigIntStats>();
  private constructor(readonly root: string, readonly stage: string, readonly content: string,
    private readonly parent: string, private readonly parentStat: BigIntStats, readonly minFreeBytes: number) {}
  static async reserve(output: string, minFreeBytes: number): Promise<Workspace> {
    if (!output || basename(output) === '.' || basename(output) === '..') throw Error('recovery_output_invalid');
    const parent = await trustedParent(dirname(resolve(output)));
    const root = join(parent, basename(resolve(output)));
    const parentStat = await lstat(parent, { bigint: true });
    await mkdir(root, { mode: 0o700 }); // exclusive no-clobber reservation
    const stage = join(root, `.staging-${randomUUID()}`), content = join(stage, 'set');
    const work = new Workspace(root, stage, content, parent, parentStat, minFreeBytes);
    work.owned.set(root, await lstat(root, { bigint: true }));
    try { await work.directory(stage); await work.directory(content); await work.checkFree(); return work; }
    catch (error) { await work.cleanup(); throw error; }
  }
  async assertOwned(path: string): Promise<void> {
    if (!identity(this.parentStat, await lstat(this.parent, { bigint: true }))) throw Error('recovery_parent_changed');
    await trustedParent(this.parent);
    let current = path;
    for (;;) {
      const expected = this.owned.get(current);
      if (!expected || !identity(expected, await lstat(current, { bigint: true }))) throw Error('recovery_workspace_changed');
      if (current === this.root) break;
      current = dirname(current);
    }
  }
  async directory(path: string): Promise<void> {
    await this.assertOwned(dirname(path)); await mkdir(path, { mode: 0o700 });
    this.owned.set(path, await lstat(path, { bigint: true }));
  }
  async file(path: string): Promise<FileHandle> {
    await this.assertOwned(dirname(path));
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    this.owned.set(path, await file.stat({ bigint: true })); return file;
  }
  async checkFree(): Promise<void> {
    const space = await statfs(this.root, { bigint: true });
    if (space.bavail * space.bsize < BigInt(this.minFreeBytes)) throw Error('recovery_space_insufficient');
  }
  async write(path: string, bytes: Buffer): Promise<void> {
    const file = await this.file(path);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  async remove(path: string): Promise<void> {
    await this.assertOwned(path);
    if (this.owned.get(path)?.isDirectory()) await rmdir(path); else await unlink(path);
    this.owned.delete(path);
  }
  async synchronize(): Promise<void> {
    for (const path of [...this.owned.keys()].reverse()) {
      await this.assertOwned(path);
      if (this.owned.get(path)?.isDirectory()) await syncDirectory(path);
    }
  }
  async publish(finalCheck: () => void): Promise<void> {
    await this.synchronize(); await this.assertOwned(this.content); await this.assertOwned(this.root);
    // The root is our exclusive 0700 reservation. Refuse any unexpected entry,
    // including a precreated content path, rather than overwrite it via rename.
    if ((await readdir(this.root)).some(name => name !== basename(this.stage))) throw Error('recovery_output_changed');
    finalCheck();
    const target = join(this.root,'content');
    await rename(this.content, target);
    try { await syncDirectory(this.root); await syncDirectory(this.parent); }
    catch (error) {
      await this.assertOwned(this.root);
      const previous = this.owned.get(this.content);
      if (previous && identity(previous, await lstat(target,{bigint:true}))) await rename(target,this.content);
      throw error;
    }
    for (const path of [...this.owned.keys()]) if (path === this.content || path.startsWith(`${this.content}/`)) this.owned.delete(path);
  }
  async cleanup(preserveRoot = false): Promise<boolean> {
    let complete = true;
    for (const path of [...this.owned.keys()].reverse()) {
      if (preserveRoot && path === this.root) continue;
      try { await this.remove(path); } catch { complete = false; /* changed/residual workspaces are never adopted or recursively erased */ }
    }
    return complete;
  }
}

/** One in-flight write and 64 KiB high water mark. Controlled plaintext is
 * cleared after the descriptor consumes it, including write-error paths. */
export function boundedSink(file: FileHandle, work: Workspace, maxBytes: number, signal: AbortSignal, clear: boolean): Writable {
  let total = 0, checked = 0;
  return new Writable({ highWaterMark: 65536, write(chunk: Buffer, _encoding, callback) {
    void (async () => {
      try {
        signal.throwIfAborted(); total += chunk.length;
        if (total > maxBytes) throw Error('recovery_size_limit');
        if (total - checked >= 16 * 1024 * 1024) { await work.checkFree(); checked = total; }
        let offset = 0;
        while (offset < chunk.length) { const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset); if (!bytesWritten) throw Error('recovery_write_failed'); offset += bytesWritten; }
        signal.throwIfAborted(); callback();
      } catch (error) { callback(error instanceof Error ? error : Error('recovery_write_failed')); }
      finally { if (clear) chunk.fill(0); }
    })();
  } });
}
