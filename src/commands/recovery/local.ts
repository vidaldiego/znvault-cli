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

export interface LocalRecoveryOptions {
  input?: string; companionInput?: string; s3Config?: string; manifest: string; reference?: string;
  expect: string; keyFile: string[]; output?: string; maxInputBytes?: string; maxExpandedBytes?: string; maxExpansionRatio?: string;
}
/** Metadata trust is established before locators/keys are consumed. All data
 * sources are explicit and remote transport credentials never enter key maps. */
export async function runRecoveryOperation(mode: 'verify' | 'extract', options: LocalRecoveryOptions): Promise<void> {
  const [{ verifyRecoverySet, MAX_METADATA_BYTES }, { loadKeyFiles, readProtectedFile }, { localInputs, s3Inputs }, { recoverSet }, { parseRecoveryJson }] = await Promise.all([
    import('../../vendor/archon-recovery-core/index.js'), import('../../lib/recovery/protected-files.js'), import('../../lib/recovery/storage.js'), import('../../lib/recovery/recover.js'), import('../../vendor/archon-recovery-core/json.js'),
  ]);
  const expected = await loadTrustedSelection(options.expect);
  const manifest = await readMetadataSnapshot(options.manifest, MAX_METADATA_BYTES);
  const reference = options.reference ? await readMetadataSnapshot(options.reference, MAX_METADATA_BYTES) : undefined;
  const set = verifyRecoverySet(expected, manifest.bytes, reference?.bytes);
  if (Boolean(options.input) === Boolean(options.s3Config) || (options.s3Config && options.companionInput) ||
      (options.input && set.components.some(c => c.role === 'companion') !== Boolean(options.companionInput))) throw Error('recovery_source_selection_invalid');
  const keys = await loadKeyFiles(options.keyFile, set);
  let remote: ReturnType<typeof s3Inputs> | undefined;
  const controller = new AbortController();
  const cancel = (): void => { controller.abort(Error('recovery_cancelled')); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (options.s3Config) {
      const bytes = await readProtectedFile(options.s3Config, 65536);
      try {
        const config: unknown = parseRecoveryJson(bytes, 65536);
        remote = s3Inputs(config);
        const secret = config as Record<string, unknown>; secret.accessKeyId = ''; secret.secretAccessKey = ''; secret.sessionToken = '';
      } finally { bytes.fill(0); }
    }
    const inputs = remote ?? localInputs({ dump:String(options.input), companion:options.companionInput });
    const result = await recoverSet(set, inputs, keys.get, { mode, output:options.output, signal:controller.signal,
      ...(options.maxInputBytes ? { maxInputBytes:Number(options.maxInputBytes) } : {}),
      ...(options.maxExpandedBytes ? { maxExpandedBytes:Number(options.maxExpandedBytes) } : {}),
      ...(options.maxExpansionRatio ? { maxExpansionRatio:Number(options.maxExpansionRatio) } : {}) });
    console.log(JSON.stringify(result));
  } finally { keys.dispose(); remote?.dispose(); process.removeListener('SIGINT',cancel); process.removeListener('SIGTERM',cancel); }
}
