import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MAX_SELECTION_BYTES, parseExpectedSelection, type ExpectedSelection } from '../../vendor/archon-recovery-core/index.js';

export interface MetadataSnapshot { bytes: Buffer; sha256: string }

/** Own bounded bytes from one regular, unlinked descriptor; reject in-place
 * changes while reading. Callers retain these bytes and never reopen the path.
 * The caller selects authority independently; this helper does not confer it. */
export async function readMetadataSnapshot(path: string, maxBytes: number): Promise<MetadataSnapshot> {
  if (!path || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SELECTION_BYTES) throw new Error('Invalid metadata file or limit');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maxBytes)) throw new Error('Metadata must be a bounded regular file without links');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (offset !== Number(before.size) || before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Metadata changed while being read');
    const bytes = Buffer.from(buffer.subarray(0, offset));
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { await handle.close(); }
}

/** PATH is an explicit selection from prior independent custody/catalogue. Never
 * search next to backup files, derive a selection, or treat a new hash as trust. */
export async function loadTrustedSelection(path: string): Promise<ExpectedSelection> {
  const snapshot = await readMetadataSnapshot(path, MAX_SELECTION_BYTES);
  return parseExpectedSelection(snapshot.bytes);
}
