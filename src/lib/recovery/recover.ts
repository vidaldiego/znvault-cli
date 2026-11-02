import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, type Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createGunzip, createZstdDecompress, constants as codecConstants } from 'node:zlib';
import { computeKeyFingerprint, decryptArcn, MAX_RECOVERY_ENCRYPTED_BYTES, openCompanion, unwrapDekHex,
  type KeyProvider, type VerifiedRecoverySet } from '../../vendor/archon-recovery-core/index.js';
import { Workspace, TemporaryReservation, boundedSink } from './workspace.js';
import { localInputs, type RecoveryInputs } from './storage.js';
import type { ObservedCiphertext, RecoveryResult } from './receipt.js';
export type { RecoveryInputs } from './storage.js';
export interface RecoveryOptions {
  mode: 'verify' | 'extract'; output?: string; signal?: AbortSignal;
  maxInputBytes?: number; maxExpandedBytes?: number; maxExpansionRatio?: number;
  minFreeBytes?: number; temporaryParent?: string;
}
const TIB = 1024 ** 4;
function limit(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1) throw Error('recovery_limit_invalid'); return n;
}
async function finish(sink: Writable): Promise<void> { sink.end(); await finished(sink); }
/** Sources and key-provider results are caller-owned. We snapshot the set and
 * copy provider buffers; provider results are never erased by this function. */
export async function recoverSet(set: VerifiedRecoverySet, inputs: RecoveryInputs, keys: KeyProvider, options: RecoveryOptions): Promise<RecoveryResult> {
  const identity = JSON.stringify(set), snapshot = structuredClone(set);
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const maxInput = limit(options.maxInputBytes, TIB), maxExpanded = limit(options.maxExpandedBytes, TIB);
  const ratio = limit(options.maxExpansionRatio, 10000), minFree = limit(options.minFreeBytes, 64 * 1024 * 1024);
  if (!['verify', 'extract'].includes(options.mode) || (options.mode === 'extract' && !options.output) ||
      (options.mode === 'verify' && options.output) || snapshot.components.length < 1 || snapshot.components.length > 2 ||
      snapshot.components[0]?.role !== 'dump' || (snapshot.components.length === 2 && snapshot.components[1].role !== 'companion') ||
      snapshot.selection.metadata.kind === 'manifest' && snapshot.metadataSha256 !== snapshot.selection.metadata.sha256) throw Error('recovery_set_invalid');
  const reservation = options.mode === 'verify' && !options.temporaryParent ? await TemporaryReservation.reserve(tmpdir()) : undefined;
  const destination = options.mode === 'extract' ? String(options.output) : join(options.temporaryParent ?? reservation!.path, `znvault-recovery-${randomUUID()}`);
  let work: Workspace;
  try { work = await Workspace.reserve(destination, minFree); }
  catch (error) { await reservation?.cleanup(); throw error; }
  const observed: ObservedCiphertext[] = []; let inputTotal = 0, expandedTotal = 0, published = false;
  let result:RecoveryResult | undefined, failure:unknown, failed=false, removed=false;
  try {
    for (const component of snapshot.components) {
      signal.throwIfAborted();
      const ciphertextPath = join(work.stage, `${component.role}.ciphertext`);
      const handle = await work.file(ciphertextPath);
      const hash = createHash('sha256'); let bytes = 0;
      const sink = boundedSink(handle, work, component.role === 'companion' ? MAX_RECOVERY_ENCRYPTED_BYTES : maxInput, signal, false);
      // pipeline owns cancellation and stream destruction, even while a source
      // stalls. Every transport receives the same cancellation signal.
      const chunks = async function* (): AsyncGenerator<Buffer> {
        for await (const chunk of inputs.open(component, signal)) {
          if (!Buffer.isBuffer(chunk)) throw Error('recovery_source_invalid');
          signal.throwIfAborted(); bytes += chunk.length; inputTotal += chunk.length;
          if (inputTotal > maxInput || (component.bytes !== null && bytes > component.bytes)) throw Error('recovery_size_limit');
          hash.update(chunk); yield chunk;
        }
      };
      try { await pipeline(Readable.from(chunks(), { objectMode:false, highWaterMark: 65536 }), sink, { signal }); await handle.sync(); }
      finally { await handle.close(); }
      const digest = hash.digest('hex');
      if ((component.bytes !== null && bytes !== component.bytes) || (component.encryptedSha256 !== null && digest !== component.encryptedSha256)) throw Error('recovery_ciphertext_mismatch');
      observed.push({ role: component.role, storageKey: component.storageKey, versionId: component.versionId, bytes, sha256: digest, previouslyPinned: component.encryptedSha256 !== null });
      const supplied = await keys(component.key, signal);
      const key = Buffer.from(supplied); let dek: Buffer | undefined;
      try {
        if (key.length !== 32 || computeKeyFingerprint(key) !== component.key.fingerprint) throw Error('recovery_key_mismatch');
        if (component.role === 'dump') {
          if (!['none','gzip','zstd'].includes(component.compression)) throw Error('recovery_format_unsupported');
          dek = unwrapDekHex(component.wrappedDek, key);
          const provisional = join(work.stage, 'dump.authenticated');
          const file = await work.file(provisional); const plainSink = boundedSink(file, work, maxExpanded, signal, true);
          try {
            await decryptArcn(localInputs({ dump: ciphertextPath }).open(component, signal), plainSink, dek, signal);
            await finish(plainSink); await file.sync();
          } finally { plainSink.destroy(); await file.close(); }
          const packed = await open(provisional, 'r');
          try {
            const packedBytes = (await packed.stat()).size;
            const expandedBound = Math.min(maxExpanded - expandedTotal, packedBytes * ratio);
            if (expandedBound < 0) throw Error('recovery_size_limit');
            const output = await work.file(join(work.content, 'database.sql'));
            const expandedSink = boundedSink(output, work, expandedBound, signal, true);
            const reader = packed.createReadStream({ autoClose: false, highWaterMark: 65536 });
            try {
              if (component.compression === 'none') await pipeline(reader, expandedSink, { signal });
              else {
                const codec = component.compression === 'gzip' ? createGunzip({ chunkSize:65536 }) : createZstdDecompress({ chunkSize:65536, params:{ [codecConstants.ZSTD_d_windowLogMax]:23 } });
                await pipeline(reader, codec, expandedSink, { signal });
                if (codec.bytesWritten !== packedBytes) throw Error('recovery_codec_trailing_data');
              }
              expandedTotal += (await output.stat()).size; await output.sync();
            } finally { expandedSink.destroy(); await output.close(); }
          } finally { await packed.close(); }
          await work.remove(provisional);
        } else {
          const source = await open(ciphertextPath, 'r'); let cipher: Buffer | undefined;
          try { cipher = await source.readFile();
            const material = openCompanion(cipher, component, key);
            await work.directory(join(work.content, 'companion'));
            const names = new Set<string>();
            try {
              for (const member of material.files) {
                if (!member.name || member.name.startsWith('/') || member.name.includes('\\') || member.name.split('/').some(p => !p || p === '.' || p === '..') || names.has(member.name)) throw Error('recovery_member_invalid');
                names.add(member.name); let parent = join(work.content, 'companion');
                const parts = member.name.split('/');
                for (const part of parts.slice(0,-1)) {
                  parent = join(parent, part);
                  try { await work.assertOwned(parent); } catch { await work.directory(parent); }
                }
                const plain = Buffer.from(member.contentBase64, 'base64');
                try { expandedTotal += plain.length;
                  if (plain.length > 128 * 1024 || expandedTotal > maxExpanded) throw Error('recovery_size_limit');
                  await work.write(join(parent, String(parts.at(-1))), plain);
                } finally { plain.fill(0); member.contentBase64 = ''; }
              }
            } finally { for (const member of material.files) member.contentBase64 = ''; }
          } finally { cipher?.fill(0); await source.close(); }
        }
      } finally { dek?.fill(0); key.fill(0); }
      await work.remove(ciphertextPath);
    }
    signal.throwIfAborted();
    if (JSON.stringify(set) !== identity || JSON.stringify(snapshot) !== identity) throw Error('recovery_identity_changed');
    const { sourceNamespace, installationUuid, serviceName, backupId } = snapshot.selection;
    result = { authenticated:true, mode:options.mode, selection:{sourceNamespace,installationUuid,serviceName,backupId}, metadataSha256:snapshot.metadataSha256, ciphertext:observed, output:options.mode === 'extract' ? work.root : null };
    if (options.mode === 'extract') {
      await work.write(join(work.content, 'recovery-receipt.json'), Buffer.from(JSON.stringify(result)));
      signal.throwIfAborted(); await work.publish(() => { signal.throwIfAborted(); if (JSON.stringify(set) !== identity || JSON.stringify(snapshot) !== identity) throw Error('recovery_identity_changed'); }); published = true;
    }
  } catch (error) { failed=true; failure=error; }
  finally { removed = await work.cleanup(published); if (reservation) removed = await reservation.cleanup() && removed; }
  if (failed) throw failure;
  if (!published && !removed) throw Error('recovery_cleanup_incomplete');
  if (!published) signal.throwIfAborted();
  if (result === undefined) throw Error('recovery_failed');
  return result;
}
