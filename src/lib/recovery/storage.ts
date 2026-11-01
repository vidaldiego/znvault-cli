import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import type { RecoveryComponent } from '../../vendor/archon-recovery-core/index.js';
import { stable } from './protected-files.js';
export interface RecoveryInputs { open(component: RecoveryComponent, signal: AbortSignal): AsyncIterable<Buffer> }
export function localInputs(paths: { dump: string; companion?: string }): RecoveryInputs {
  return { async *open(component, signal) {
    signal.throwIfAborted(); const path = paths[component.role];
    if (!path) throw Error('recovery_source_missing');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n) throw Error('recovery_source_unsafe');
      let offset = 0;
      for (;;) {
        signal.throwIfAborted(); const buffer = Buffer.allocUnsafe(65536);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        offset += bytesRead; yield buffer.subarray(0, bytesRead);
      }
      if (BigInt(offset) !== before.size || !stable(before, await handle.stat({ bigint: true })) ||
          !stable(before, await lstat(path, { bigint: true }))) throw Error('recovery_source_changed');
      signal.throwIfAborted();
    } finally { await handle.close(); }
  } };
}

// SDK is loaded only for the explicitly selected remote transport. Local
// recovery does not evaluate AWS configuration or credential-provider modules.
export interface S3RecoveryConfig {
  endpoint: string; region: string; bucket: string;
  accessKeyId: string; secretAccessKey: string; sessionToken?: string; tlsCaPem?: string;
  deadlineMs?: number;
}
export interface RemoteRecoveryInputs extends RecoveryInputs { dispose(): void }
export function s3Inputs(config: S3RecoveryConfig): RemoteRecoveryInputs {
  const endpoint = new URL(config.endpoint);
  const validText = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && !Array.from(s).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  const deadlineMs = config.deadlineMs ?? 30000;
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      !/^[A-Za-z0-9-]{1,80}$/.test(config.region) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !validText(config.accessKeyId, 256) || !validText(config.secretAccessKey, 4096) || (config.sessionToken !== undefined && !validText(config.sessionToken, 16384)) ||
      (config.tlsCaPem !== undefined && (typeof config.tlsCaPem !== 'string' || config.tlsCaPem.length > 16384)) ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 120000) throw Error('recovery_s3_config_invalid');
  const region=config.region, bucket=config.bucket, tlsCaPem=config.tlsCaPem;
  let disposed = false;
  let cleanup: (() => void) | undefined;
  // A private copy is never exported or shared with the Vault key provider.
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}) };
  return { dispose() { disposed = true; cleanup?.(); credentials.accessKeyId = ''; credentials.secretAccessKey = ''; if (credentials.sessionToken) credentials.sessionToken = ''; },
    async *open(component, signal) {
      if (disposed) throw Error('recovery_s3_disposed');
      if (component.versionId === null && (component.encryptedSha256 === null || component.bytes === null)) throw Error('recovery_s3_unpinned_history');
      const [{ S3Client, HeadObjectCommand, GetObjectCommand }, { Agent }] = await Promise.all([import('@aws-sdk/client-s3'), import('node:https')]);
      const agent = new Agent({ rejectUnauthorized:true, ...(tlsCaPem ? { ca:tlsCaPem } : {}) });
      const client = new S3Client({ region, endpoint:endpoint.origin, forcePathStyle:true, credentials,
        maxAttempts:2, followRegionRedirects:false, requestHandler:{ httpsAgent:agent, connectionTimeout:Math.min(deadlineMs,5000), requestTimeout:deadlineMs, throwOnRequestTimeout:true } });
      cleanup = () => { client.destroy(); agent.destroy(); };
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
      // Reject any endpoint/region redirect before signing/sending credentials.
      client.middlewareStack.add((next) => async args => {
        const request = args.request as { protocol?: string; hostname?: string; port?: number };
        if (request.protocol !== endpoint.protocol || request.hostname !== endpoint.hostname || (request.port ?? 443) !== Number(endpoint.port || 443)) throw Error('recovery_s3_origin_changed');
        return next(args);
      }, { step:'build', name:'recoveryFixedOrigin', priority:'high' });
      const exact = { Bucket:bucket, Key:component.storageKey, ...(component.versionId !== null ? { VersionId:component.versionId } : {}) };
      let body: import('node:stream').Readable | undefined;
      try {
        boundedSignal.throwIfAborted();
        const head = await client.send(new HeadObjectCommand(exact), { abortSignal:boundedSignal });
        if (head.DeleteMarker || (component.versionId !== null && head.VersionId !== component.versionId) ||
            (component.versionId === null && head.VersionId !== undefined && head.VersionId !== 'null') ||
            !Number.isSafeInteger(head.ContentLength) || Number(head.ContentLength) < 1 || (component.bytes !== null && head.ContentLength !== component.bytes)) throw Error('recovery_s3_identity_mismatch');
        const response = await client.send(new GetObjectCommand(exact), { abortSignal:boundedSignal });
        if (response.DeleteMarker || response.VersionId !== head.VersionId || response.ContentLength !== head.ContentLength ||
            !response.Body || !('destroy' in response.Body) || !(Symbol.asyncIterator in response.Body)) throw Error('recovery_s3_identity_mismatch');
        body = response.Body;
        const stop = (): void => { body?.destroy(Error('recovery_s3_cancelled')); };
        boundedSignal.addEventListener('abort', stop, { once:true });
        try {
          let bytes = 0;
          for await (const chunk of body) { boundedSignal.throwIfAborted(); const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); bytes += buffer.length; if (bytes > Number(head.ContentLength)) throw Error('recovery_s3_size_mismatch'); yield buffer; }
          if (bytes !== head.ContentLength) throw Error('recovery_s3_size_mismatch'); boundedSignal.throwIfAborted();
        } finally { boundedSignal.removeEventListener('abort', stop); }
      } catch { throw Error('recovery_s3_read_failed'); }
      finally { body?.destroy(); client.destroy(); agent.destroy(); cleanup = undefined; }
    } };
}
