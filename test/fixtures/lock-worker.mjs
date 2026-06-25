// Path: test/fixtures/lock-worker.mjs
// Usage:
//   node lock-worker.mjs <configDir> <lockKey> <holdMs> [acquireTimeoutMs]
//   node lock-worker.mjs <configDir> --token <refreshToken> <profileName> <holdMs> [acquireTimeoutMs]
//
// Standalone worker for the cross-process refresh-lock survival tests. Spawned
// as a REAL OS process by test/lib/refresh-lock-crossproc.test.ts so that the
// proper-lockfile cross-process semantics (which an in-process vitest mock
// cannot exercise) are validated against actual OS-level file locks.
//
// It imports the *built* lock module from dist/ (the in-process `conf` mock does
// not apply in a child process) and isolates all on-disk state — the K_local
// HMAC key, the lock files — under the test-provided ZNVAULT_CONFIG_DIR.
//
// In `--token` mode the worker derives the lock key in-process via the real
// computeLockKey(refreshToken, profile). Because K_local is per-install (shared
// config dir) and the key is HMAC(refreshToken), two `--token` workers with the
// SAME token but DIFFERENT profiles derive the SAME lock key and must serialize.
//
// The worker exits 0 after releasing; it deliberately does NOT trap SIGKILL so
// the dead-holder/stale-reclaim test can kill it mid-hold and leave the lock.
process.env.ZNVAULT_CONFIG_DIR = process.argv[2];
const { acquireRefreshLock, computeLockKey } = await import('../../dist/lib/client/refresh-lock.js');

let lockKey;
let holdMs;
let acquireTimeoutMs;
if (process.argv[3] === '--token') {
  const [, , , , refreshToken, profileName, hold, timeout] = process.argv;
  lockKey = computeLockKey(refreshToken, profileName);
  holdMs = hold;
  acquireTimeoutMs = timeout;
} else {
  const [, , , key, hold, timeout] = process.argv;
  lockKey = key;
  holdMs = hold;
  acquireTimeoutMs = timeout;
}

const opts = acquireTimeoutMs !== undefined ? { timeoutMs: Number(acquireTimeoutMs) } : { timeoutMs: 8000 };
const lock = await acquireRefreshLock(lockKey, opts);
const acquiredAt = Date.now();
process.stdout.write(
  JSON.stringify({ pid: process.pid, acquired: !!lock, lockKey, acquiredAt }) + '\n'
);
if (lock) {
  // Hold the lock for holdMs, then mark the moment we are about to release so
  // the parent can build a true [acquiredAt, releasedAt] window for overlap
  // detection (more accurate than acquiredAt + holdMs when the OS is loaded).
  await new Promise(r => setTimeout(r, Number(holdMs)));
  const releasedAt = Date.now();
  process.stdout.write(JSON.stringify({ pid: process.pid, releasedAt }) + '\n');
  await lock.release();
}
