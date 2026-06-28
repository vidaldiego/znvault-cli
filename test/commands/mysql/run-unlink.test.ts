// test/commands/mysql/run-unlink.test.ts

/**
 * I-3 (F1): runMysql must unlink the cnf directory entry IMMEDIATELY after the
 * child mysql has been spawned (mysql reads --defaults-extra-file at startup),
 * so no plaintext directory entry persists for the lifetime of the run and a
 * `kill -9` leaves nothing on disk.
 *
 * Strategy:
 *   - Mock node:child_process so spawn returns a controllable fake child that
 *     does NOT close until we tell it to. This lets us assert that the cnf file
 *     is already unlinked WHILE the (fake) child is still "running".
 *   - Use a REAL temp cnf file so the unlink is observable on disk.
 *   - Stub assertMysqlOnPath's PATH lookup by setting PATH to a dir that holds
 *     an executable named `mysql` (a tiny shell stub) — the binary is never run
 *     because spawn is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Controllable fake child + spawn mock.
interface FakeChild extends EventEmitter {
  stdin: { end: (buf?: unknown) => void };
}
let lastChild: FakeChild | undefined;
const spawnMock = vi.fn((): FakeChild => {
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

describe('runMysql — spawn-then-unlink (I-3 / F1)', () => {
  it('unlinks the cnf right after spawn while the child is still running, then resolves', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');

    // Real cnf file on disk.
    const cnfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znv-cnf-'));
    const cnfPath = path.join(cnfDir, 'my.cnf');
    fs.writeFileSync(cnfPath, '[client]\nuser=u\npassword=p\nhost=h\nport=3306\n', { mode: 0o600 });
    expect(fs.existsSync(cnfPath)).toBe(true);

    // Kick off runMysql in connect mode (simplest spawn path).
    const promise = runMysql({ cnfPath, mode: 'connect' });

    // Let microtasks flush so spawn + the post-spawn unlink have happened
    // while the fake child has NOT yet emitted 'close'.
    await new Promise((r) => setImmediate(r));

    // spawn was called, child is "running", but the cnf entry is already gone.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(lastChild).toBeDefined();
    expect(fs.existsSync(cnfPath)).toBe(false);

    // Now let the child exit; runMysql should resolve with the exit code.
    lastChild!.emit('close', 0);
    const code = await promise;
    expect(code).toBe(0);

    try { fs.rmSync(cnfDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('does not throw if the cnf is already gone when runMysql tries to unlink it', async () => {
    const { runMysql } = await import('../../../src/commands/mysql/run.js');

    // Point at a non-existent cnf path — the post-spawn unlink must be best-effort.
    const cnfPath = path.join(os.tmpdir(), 'znv-missing-cnf', 'my.cnf');
    expect(fs.existsSync(cnfPath)).toBe(false);

    const promise = runMysql({ cnfPath, mode: 'connect' });
    await new Promise((r) => setImmediate(r));
    expect(spawnMock).toHaveBeenCalledTimes(1);

    lastChild!.emit('close', 0);
    const code = await promise;
    expect(code).toBe(0);
  });
});
