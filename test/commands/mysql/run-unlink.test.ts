// test/commands/mysql/run-unlink.test.ts

/**
 * F1 (fd inheritance): runMysql passes the cnf to mysql as an inherited OPEN FD,
 * NOT a path it unlinks after spawn. createMyCnf already unlinked the directory
 * entry (the inode is kept alive by the fd), so:
 *
 *   - runMysql must NOT unlink anything itself (there is nothing to unlink — the
 *     old "spawn-then-unlink" race is gone). It must spawn with a stdio array
 *     that inherits the cnf fd at the SAME number, so /dev/fd/<fd> resolves in
 *     the child.
 *   - The defining assertion: the stdio array passed to spawn() has
 *     stdio[fd] === fd.
 *
 * Strategy:
 *   - Mock node:child_process so spawn returns a controllable fake child and we
 *     can capture the stdio array it was called with.
 *   - Stub assertMysqlOnPath's PATH lookup by setting PATH to a dir holding an
 *     executable named `mysql` (a tiny shell stub) — the binary is never run
 *     because spawn is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Controllable fake child + spawn mock that captures its arguments.
interface FakeChild extends EventEmitter {
  stdin: { end: (buf?: unknown) => void };
}
let lastChild: FakeChild | undefined;
let lastSpawnStdio: unknown;
const spawnMock = vi.fn((_bin: string, _args: string[], opts: { stdio: unknown }): FakeChild => {
  lastSpawnStdio = opts.stdio;
  const child = new EventEmitter() as FakeChild;
  child.stdin = { end: vi.fn() };
  lastChild = child;
  return child;
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

let mysqlDir: string;
let mysqlStub: string;
let originalPath: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  lastChild = undefined;
  lastSpawnStdio = undefined;

  // Create a throwaway dir holding an executable named `mysql` so
  // assertMysqlOnPath resolves successfully. spawn is mocked, so it never runs.
  mysqlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znv-mysqlbin-'));
  mysqlStub = path.join(mysqlDir, 'mysql');
  fs.writeFileSync(mysqlStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  originalPath = process.env.PATH;
  process.env.PATH = mysqlDir;
});

afterEach(() => {
  process.env.PATH = originalPath;
  try { fs.rmSync(mysqlDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('runMysql — fd inheritance (F1)', () => {
  it('connect mode: inherits the cnf fd at its own number (stdio[fd] === fd) and resolves with the exit code', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');

    const fd = 13;
    const promise = runMysql({ fd, fdPath: `/dev/fd/${fd.toString()}`, mode: 'connect' });

    // Let microtasks flush so spawn has been called.
    await new Promise((r) => setImmediate(r));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const stdio = lastSpawnStdio as unknown[];
    // The defining F1 invariant: the cnf fd is inherited at its own index.
    expect(stdio[fd]).toBe(fd);
    // connect mode inherits std streams.
    expect(stdio[0]).toBe('inherit');
    expect(stdio[1]).toBe('inherit');
    expect(stdio[2]).toBe('inherit');

    // --defaults-extra-file=/dev/fd/<fd> is args[0].
    const args = spawnMock.mock.calls[0][1];
    expect(args[0]).toBe(`--defaults-extra-file=/dev/fd/${fd.toString()}`);

    lastChild!.emit('close', 0);
    const code = await promise;
    expect(code).toBe(0);
  });

  it('exec mode (inline sql): stdin is piped, cnf fd inherited at its number, SQL is written to stdin', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');

    const fd = 9;
    const promise = runMysql({
      fd,
      fdPath: `/dev/fd/${fd.toString()}`,
      mode: 'exec',
      sql: "SELECT 'x';",
    });
    await new Promise((r) => setImmediate(r));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const stdio = lastSpawnStdio as unknown[];
    expect(stdio[0]).toBe('pipe'); // exec pipes SQL into stdin
    expect(stdio[fd]).toBe(fd);    // cnf fd inherited at its own number
    // SQL was written to the child's stdin.
    expect(lastChild!.stdin.end).toHaveBeenCalled();

    lastChild!.emit('close', 0);
    const code = await promise;
    expect(code).toBe(0);
  });

  it('does NOT remove the cnf backing entry (createMyCnf owns the unlink; runMysql only inherits)', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');

    // Use a REAL temp file (still linked) so that if runMysql wrongly unlinked
    // anything, it would be observable on disk. The old broken design unlinked
    // a path after spawn; the new design must touch the filesystem entry not at
    // all — it inherits an fd whose name was already removed by createMyCnf.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'znv-cnf-survive-'));
    const cnfFile = path.join(dir, 'my.cnf');
    fs.writeFileSync(cnfFile, '[client]\nuser=u\npassword=p\nhost=h\nport=3306\n', { mode: 0o600 });
    const realFd = fs.openSync(cnfFile, 'r');

    try {
      const promise = runMysql({ fd: realFd, fdPath: `/dev/fd/${realFd.toString()}`, mode: 'connect' });
      await new Promise((r) => setImmediate(r));

      lastChild!.emit('close', 0);
      await promise;

      // runMysql must NOT have removed the directory entry.
      expect(fs.existsSync(cnfFile)).toBe(true);
    } finally {
      try { fs.closeSync(realFd); } catch { /* ignore */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
