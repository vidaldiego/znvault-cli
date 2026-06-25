// Path: src/lib/client/refresh-lock.ts

/**
 * Cross-process refresh lock (Workstream A).
 *
 * Serializes `POST /auth/refresh` across concurrent `znvault` processes on one
 * machine. The lock is keyed by HMAC-SHA256(refreshToken, K_local) so two
 * profiles holding the *same copied token* still serialize, while the on-disk
 * lock name is not a stable, globally-correlatable fingerprint of the token.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { getConfigPath } from '../config/store.js';

/** Acquire-retry budget before best-effort fallback (no token, no lock). */
export const REFRESH_LOCK_TIMEOUT_MS = 5000;

const K_LOCAL_BYTES = 32;
const K_LOCAL_FILE = 'lock-hmac.key';
const LOCKS_DIR = 'locks';

let cachedKey: Buffer | null = null;

function configDir(): string {
  return dirname(getConfigPath());
}

/** Read or lazily create the per-install K_local (32 bytes, mode 0600). */
export function getLocalHmacKey(): Buffer {
  if (cachedKey) return cachedKey;
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, K_LOCAL_FILE);
  if (existsSync(keyPath)) {
    cachedKey = readFileSync(keyPath);
    return cachedKey;
  }
  const key = randomBytes(K_LOCAL_BYTES);
  writeFileSync(keyPath, key, { mode: 0o600 });
  cachedKey = key;
  return key;
}

/**
 * Lock key for a refresh token. Hex HMAC when a token is present (profile
 * independent — same copied token serializes across profiles); a stable
 * per-profile fallback otherwise.
 */
export function computeLockKey(refreshToken: string | undefined, profileName: string): string {
  if (!refreshToken) return `profile:${profileName}`;
  return createHmac('sha256', getLocalHmacKey())
    .update(refreshToken, 'utf8')
    .digest('hex');
}

/** On-disk lock file path for a derived key. */
export function lockFilePathFor(lockKey: string): string {
  const dir = join(configDir(), LOCKS_DIR);
  mkdirSync(dir, { recursive: true });
  // A fallback "profile:foo" key is not hex; make it filesystem-safe.
  const safe = lockKey.replace(/[^0-9a-zA-Z._-]/g, '_');
  return join(dir, `${safe}.lock`);
}

export interface AcquiredLock {
  lockKey: string;
  release(): Promise<void>;
}

/**
 * Best-effort cross-process lock. Returns the held lock, or `null` if it could
 * not be acquired within the timeout (caller proceeds without it; the server
 * grace-window absorbs any residual race). Never throws on contention.
 */
export async function acquireRefreshLock(
  lockKey: string,
  opts?: { timeoutMs?: number }
): Promise<AcquiredLock | null> {
  const timeoutMs = opts?.timeoutMs ?? REFRESH_LOCK_TIMEOUT_MS;
  const target = lockFilePathFor(lockKey);
  // proper-lockfile locks a path that must exist; touch the lock target.
  if (!existsSync(target)) writeFileSync(target, '', { mode: 0o600 });
  try {
    const release = await lockfile.lock(target, {
      stale: 10_000, // dead-holder reclaim; live holder heartbeats below
      update: 2_000, // mtime heartbeat so a slow live holder is NOT broken
      retries: {
        retries: Math.ceil(timeoutMs / 100),
        factor: 1,
        minTimeout: 100,
        maxTimeout: 100,
      },
    });
    return {
      lockKey,
      release: async () => {
        try {
          await release();
        } catch {
          /* already released / stale-broken — non-fatal */
        }
      },
    };
  } catch {
    // Timed out or could not acquire: best-effort, proceed without the lock.
    return null;
  }
}
