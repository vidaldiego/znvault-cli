import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import lockfile from 'proper-lockfile';

const PROFILE_LOCK_STALE_MS = 10_000;
const PROFILE_LOCK_RETRY_MS = 100;
const PROFILE_LOCK_RETRIES = 50;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

let heldDepth = 0;

function profileLockTarget(configPath: string): string {
  const directory = join(dirname(configPath), 'locks');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, 'profile-store.lock');
  if (!existsSync(target)) {
    try {
      writeFileSync(target, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new Error('CLI profile store lock is unavailable');
      }
    }
  }
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('CLI profile store lock is unsafe');
  }
  return target;
}

/**
 * Execute one synchronous profile-store transaction under a cross-process
 * lock. Profile mutations are deliberately tiny and synchronous; a dead
 * process is reclaimable after the stale interval.
 */
export function withProfileMutationLock<T>(configPath: string, operation: () => T): T {
  if (heldDepth > 0) return operation();

  let release: (() => void) | undefined;
  const target = profileLockTarget(configPath);
  for (let attempt = 0; attempt <= PROFILE_LOCK_RETRIES; attempt += 1) {
    try {
      release = lockfile.lockSync(target, { stale: PROFILE_LOCK_STALE_MS });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') {
        throw new Error('CLI profile store lock is unavailable');
      }
      if (attempt === PROFILE_LOCK_RETRIES) {
        throw new Error('CLI profile store is busy');
      }
      Atomics.wait(sleepBuffer, 0, 0, PROFILE_LOCK_RETRY_MS);
    }
  }
  if (!release) throw new Error('CLI profile store is busy');

  heldDepth += 1;
  try {
    return operation();
  } finally {
    heldDepth -= 1;
    release();
  }
}
