import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configDir: string;

vi.mock('../../src/lib/config/store.js', () => ({
  getConfigPath: vi.fn(() => join(configDir, 'config.json')),
}));

describe('refresh-lock key derivation', () => {
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'znv-lock-'));
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('persists K_local once at <configDir>/lock-hmac.key mode 0600', async () => {
    const { getLocalHmacKey } = await import('../../src/lib/client/refresh-lock.js');
    const k1 = getLocalHmacKey();
    const keyPath = join(configDir, 'lock-hmac.key');
    expect(existsSync(keyPath)).toBe(true);
    expect(k1.length).toBe(32);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    const onDisk = readFileSync(keyPath);
    expect(Buffer.compare(k1, onDisk)).toBe(0);
  });

  it('computeLockKey is HMAC-keyed: same token -> same key, different token -> different key', async () => {
    const { computeLockKey } = await import('../../src/lib/client/refresh-lock.js');
    const a = computeLockKey('refresh-token-A', 'prod');
    const b = computeLockKey('refresh-token-A', 'staging'); // profile must NOT change the key
    const c = computeLockKey('refresh-token-B', 'prod');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);            // same copied token, different profile -> same lock (finding #7)
    expect(a).not.toBe(c);        // different token -> different lock
  });

  it('falls back to a per-profile key when no token is present', async () => {
    const { computeLockKey } = await import('../../src/lib/client/refresh-lock.js');
    expect(computeLockKey(undefined, 'prod')).toBe('profile:prod');
  });

  it('regenerates K_local if the on-disk key is not exactly 32 bytes', async () => {
    const { getLocalHmacKey } = await import('../../src/lib/client/refresh-lock.js');
    const fs = await import('node:fs');
    const keyPath = join(configDir, 'lock-hmac.key');

    // Write a deliberately corrupt key file (truncated to 5 bytes)
    fs.writeFileSync(keyPath, Buffer.alloc(5), { mode: 0o600 });

    // Reset modules so the cache is cleared and the read path runs
    vi.resetModules();

    // Re-import and call getLocalHmacKey — should detect the truncated file
    // and regenerate it
    const { getLocalHmacKey: refetch } = await import('../../src/lib/client/refresh-lock.js');
    const k = refetch();

    // Assert the returned buffer is exactly 32 bytes
    expect(k.length).toBe(32);

    // Assert the on-disk file is also exactly 32 bytes (regenerated)
    const onDisk = fs.readFileSync(keyPath);
    expect(onDisk.length).toBe(32);
  });
});
