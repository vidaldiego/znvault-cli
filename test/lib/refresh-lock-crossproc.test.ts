// Path: test/lib/refresh-lock-crossproc.test.ts
//
// Cross-process refresh-lock survival tests (design §5.2). These spawn REAL OS
// processes that each call the *built* acquireRefreshLock against actual
// proper-lockfile file locks — the thing an in-process vitest mock cannot prove.
// Every process is pointed at a fresh per-test ZNVAULT_CONFIG_DIR under the OS
// tmp dir, so K_local, the lock files, and the profile never touch the real user
// config or the real lock dir.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER = resolve(__dirname, '../fixtures/lock-worker.mjs');
let configDir: string;

interface WorkerWindow {
  pid: number;
  acquired: boolean;
  lockKey: string;
  acquiredAt: number;
  releasedAt: number;
}

/** Parse the (one or two) JSON lines a worker emits into a single window. */
function parseWorker(stdout: string): WorkerWindow {
  const lines = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const head = lines[0] as { pid: number; acquired: boolean; lockKey: string; acquiredAt: number };
  const tail = lines.find((l) => typeof (l as { releasedAt?: number }).releasedAt === 'number') as
    | { releasedAt: number }
    | undefined;
  return {
    pid: head.pid,
    acquired: head.acquired,
    lockKey: head.lockKey,
    acquiredAt: head.acquiredAt,
    // If it never acquired (timed out) there is no release; collapse the window.
    releasedAt: tail?.releasedAt ?? head.acquiredAt,
  };
}

/** Spawn a worker that acquires `lockKey`, holds `holdMs`, then releases. */
function runWorker(args: string[]): Promise<WorkerWindow> {
  return new Promise((resolveP, reject) => {
    const child = spawn('node', [WORKER, configDir, ...args], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', () => {
      try {
        resolveP(parseWorker(out));
      } catch {
        reject(new Error(`worker output: ${out}`));
      }
    });
    child.on('error', reject);
  });
}

/** Do two [acquiredAt, releasedAt] windows overlap in wall-clock time? */
function overlaps(a: WorkerWindow, b: WorkerWindow): boolean {
  return a.acquiredAt < b.releasedAt && b.acquiredAt < a.releasedAt;
}

describe('cross-process refresh lock (real OS processes)', () => {
  beforeAll(() => {
    // The worker imports from dist/, so the suite is coupled to a fresh build (F6).
    execFileSync('npm', ['run', 'build'], { cwd: resolve(__dirname, '../..'), stdio: 'inherit' });
  }, 120000);
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'znv-xproc-'));
  });
  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('two processes serialize on the same lock key (no overlap)', async () => {
    const [a, b] = await Promise.all([runWorker(['shared', '500']), runWorker(['shared', '500'])]);
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
    expect(overlaps(a, b)).toBe(false); // only one holds it at a time
  }, 20000);

  it('same token + different profiles derive the same key and still serialize', async () => {
    // --token mode: lock key = HMAC(token, K_local), profile-independent. Two
    // processes with the SAME copied token but DIFFERENT profiles must serialize.
    const [a, b] = await Promise.all([
      runWorker(['--token', 'copied-refresh-token', 'profile-a', '500']),
      runWorker(['--token', 'copied-refresh-token', 'profile-b', '500']),
    ]);
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
    expect(a.lockKey).toBe(b.lockKey); // token-keyed, not profile-keyed
    expect(overlaps(a, b)).toBe(false); // and therefore serialized
  }, 20000);

  it('a cleanly-released holder leaves a reclaimable lock; a fresh acquire still succeeds', async () => {
    await runWorker(['reclaim', '10']); // exits, releasing
    const out = execFileSync('node', [WORKER, configDir, 'reclaim', '0']).toString();
    expect(parseWorker(out).acquired).toBe(true);
  }, 20000);

  it('a SIGKILLed holder leaves a stale lock that a later process reclaims', async () => {
    // Start a holder that would hold "forever", then SIGKILL it mid-hold so it
    // can NOT release — the lock file is left behind. proper-lockfile treats a
    // lock whose mtime is older than `stale` (10s) as reclaimable, so a process
    // that starts after the stale window acquires it. This is the genuine
    // dead-holder reclaim path (vs. the clean-release case above).
    const holder = spawn('node', [WORKER, configDir, 'stale-key', '60000'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    // Wait until the holder reports it acquired, then kill it ungracefully.
    await new Promise<void>((r) => holder.stdout.on('data', () => r()));
    holder.kill('SIGKILL');
    await new Promise<void>((r) => holder.on('exit', () => r()));
    // A contender that retries past the 10s stale window must reclaim the lock.
    const reclaimer = await runWorker(['stale-key', '0', '13000']);
    expect(reclaimer.acquired).toBe(true);
  }, 20000);

  it('best-effort: a contender that cannot acquire within its timeout returns null and does not hang', async () => {
    // A live holder keeps the lock (heartbeat) for 2s. A contender with a short
    // 500ms acquire timeout can NOT get it before the holder releases, so it must
    // return null (best-effort) and EXIT promptly — never hang the test.
    const holder = runWorker(['busy-key', '2000']);
    // Give the holder a beat to take the lock first.
    await new Promise((r) => setTimeout(r, 150));
    const contender = await runWorker(['busy-key', '0', '500']);
    expect(contender.acquired).toBe(false); // timed out -> best-effort null
    await holder; // holder still releases cleanly
  }, 20000);
});
