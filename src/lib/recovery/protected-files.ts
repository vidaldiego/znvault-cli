import { constants, type BigIntStats } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { decodeMasterKeyBytes } from '../../vendor/archon-recovery-core/arcn-envelope.js';
import { computeKeyFingerprint, type KeyProvider, type VerifiedRecoverySet } from '../../vendor/archon-recovery-core/index.js';

export function stable(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** Resolve an existing parent once, then reject writable/unowned ancestry. Root
 * owned sticky system temporary ancestors are allowed; the immediate parent
 * must be owned by this uid and private against other writers. */
export async function trustedParent(path: string): Promise<string> {
  const parent = await realpath(resolve(path));
  let current = parent;
  for (;;) {
    const stat = await lstat(current);
    const own = stat.uid === process.getuid?.();
    const system = stat.uid === 0;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (!own && !system) ||
        ((stat.mode & 0o022) !== 0 && !(system && (stat.mode & 0o1000) !== 0)) ||
        (current === parent && (!own || (stat.mode & 0o022) !== 0))) throw Error('recovery_parent_unsafe');
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  return parent;
}

export async function readProtectedFile(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let buffer: Buffer | undefined;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid?.() ?? -1) ||
        (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > BigInt(maxBytes)) throw Error('recovery_protected_file_unsafe');
    buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== Number(before.size) || !stable(before, await handle.stat({ bigint: true })) ||
        !stable(before, await lstat(path, { bigint: true }))) throw Error('recovery_protected_file_changed');
    return Buffer.from(buffer.subarray(0, offset));
  } finally { buffer?.fill(0); await handle.close(); }
}

export interface LocalKeys { get: KeyProvider; dispose(): void }
/** Existing protected raw32 or64hex/LF custody; decoding is entirely in memory. */
export async function loadKeyFiles(paths: readonly string[], set: VerifiedRecoverySet): Promise<LocalKeys> {
  const map = new Map<string, Buffer>();
  try {
    if (paths.length < 1 || paths.length > 32) throw Error('recovery_key_set_invalid');
    const required = new Set(set.components.map(c => c.key.fingerprint));
    for (const path of paths) {
      const input = await readProtectedFile(path, 65);
      let key: Buffer;
      try { key = decodeMasterKeyBytes(input); } finally { input.fill(0); }
      const fingerprint = computeKeyFingerprint(key);
      if (key.length !== 32 || map.has(fingerprint) || !required.has(fingerprint)) { key.fill(0); throw Error('recovery_key_set_invalid'); }
      map.set(fingerprint, key);
    }
    if (map.size !== required.size) throw Error('recovery_key_set_invalid');
    return { get: (key, signal) => {
      signal.throwIfAborted(); const bytes = map.get(key.fingerprint);
      if (!bytes) return Promise.reject(Error('recovery_key_missing'));
      return Promise.resolve(bytes);
    }, dispose() { for (const b of map.values()) b.fill(0); map.clear(); } };
  } catch (error) { for (const b of map.values()) b.fill(0); throw error; }
}
