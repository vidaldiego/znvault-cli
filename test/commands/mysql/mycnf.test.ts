// test/commands/mysql/mycnf.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { createMyCnf } from '../../../src/commands/mysql/mycnf.js';

/** Candidate roots createMyCnf may use (memory-backed first, then os tmp). */
const TMP_ROOTS = ['/dev/shm', os.tmpdir()];

/** Find an EMPTY znvault-my-* dir (the backing dir after the cnf was unlinked). */
function findEmptyBackingDir(): string | undefined {
  for (const root of TMP_ROOTS) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(root); } catch { /* dir may not exist */ }
    for (const e of entries) {
      if (e.startsWith('znvault-my-')) {
        const full = nodePath.join(root, e);
        try {
          if (fs.readdirSync(full).length === 0) return full;
        } catch { /* ignore */ }
      }
    }
  }
  return undefined;
}

describe('createMyCnf', () => {
  // ── F1: open → write → unlink-immediately, hand back an OPEN FD ───────────
  // The directory entry must be GONE the instant createMyCnf returns (no
  // plaintext name on disk for the run), but the inode must stay alive via the
  // returned fd so the child mysql can re-open it through /dev/fd/<fd>.
  it('returns an open fd + /dev/fd path with the cnf already unlinked from disk', async () => {
    const { fd, fdPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });

    try {
      // fd is a real integer descriptor.
      expect(Number.isInteger(fd)).toBe(true);
      expect(fd).toBeGreaterThanOrEqual(3); // not a std stream

      // fdPath is /dev/fd/<fd>.
      expect(fdPath).toBe(`/dev/fd/${fd.toString()}`);

      // The fd is valid — fstat must succeed (the inode is alive).
      const fstat = fs.fstatSync(fd);
      expect(fstat.isFile()).toBe(true);
      // 0600 perms on the inode.
      expect(fstat.mode & 0o777).toBe(0o600);

      // The cnf PATH must NOT exist on disk — the directory entry is unlinked.
      // No my.cnf may exist in any znvault-my-* dir (the dir survives, empty).
      for (const root of TMP_ROOTS) {
        let entries: string[] = [];
        try { entries = fs.readdirSync(root); } catch { /* dir may not exist */ }
        for (const e of entries) {
          if (e.startsWith('znvault-my-')) {
            const inner = fs.readdirSync(nodePath.join(root, e));
            // The dir exists but must be EMPTY (the cnf was unlinked).
            expect(inner).not.toContain('my.cnf');
          }
        }
      }

      // The bytes are readable through the fd (mysql re-opens via /dev/fd).
      const buf = Buffer.alloc(fstat.size);
      fs.readSync(fd, buf, 0, fstat.size, 0);
      const content = buf.toString('utf8');
      expect(content).toContain('[client]');
      expect(content).toContain('user=u');
      expect(content).toContain('password=p');
      expect(content).toContain('host=h');
      expect(content).toContain('port=3306');
    } finally {
      cleanup();
    }
  });

  it('creates the backing temp dir 0700 and rmdirs it on cleanup', async () => {
    const { fdPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    // fdPath is /dev/fd/<fd>; the real dir is the znvault-my-* under a tmp root.
    expect(fdPath).toMatch(/^\/dev\/fd\/\d+$/);

    // Find the (empty) backing dir and assert 0700.
    const foundDir = findEmptyBackingDir();
    expect(foundDir).toBeDefined();
    const dirStat = fs.statSync(foundDir!);
    expect(dirStat.mode & 0o777).toBe(0o700);

    cleanup();
    // After cleanup the dir is rmdir'd.
    expect(fs.existsSync(foundDir!)).toBe(false);
  });

  // ── cleanup() must be idempotent / best-effort ───────────────────────────
  it('cleanup() is idempotent — calling it twice does not throw and closes the fd once', async () => {
    const { fd, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    // fd is valid before cleanup.
    expect(() => fs.fstatSync(fd)).not.toThrow();

    cleanup();
    // After cleanup the fd is closed — fstat should now throw EBADF.
    expect(() => fs.fstatSync(fd)).toThrow();

    // Second cleanup() must be a no-op, never throwing (does not double-close).
    expect(() => { cleanup(); }).not.toThrow();
  });

  it('cleanup() is safe even if the backing dir was already removed', async () => {
    const { fd, fdPath, cleanup } = await createMyCnf({ user: 'u', password: 'p', host: 'h', port: 3306 });
    expect(fdPath).toBe(`/dev/fd/${fd.toString()}`);

    // Simulate the dir already being gone (e.g. external tmp reaper).
    const dir = findEmptyBackingDir();
    if (dir !== undefined) {
      try { fs.rmdirSync(dir); } catch { /* ignore */ }
    }

    // cleanup must still close the fd and not throw on the missing dir.
    expect(() => { cleanup(); }).not.toThrow();
    expect(() => fs.fstatSync(fd)).toThrow();
  });
});
