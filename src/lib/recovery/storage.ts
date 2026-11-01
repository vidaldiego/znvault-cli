import { constants } from 'node:fs';
import { X509Certificate } from 'node:crypto';
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
/** This is an untrusted-input boundary, including direct library callers.
 * Presence is not a type check: SDK null/default coercions must never select
 * ambient region, credentials, trust or timeout settings. */
function validateS3Config(value: unknown): S3RecoveryConfig {
  const invalid = (): never => { throw Error('recovery_s3_config_invalid'); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const required = ['endpoint','region','bucket','accessKeyId','secretAccessKey'];
  const allowed = [...required,'sessionToken','tlsCaPem','deadlineMs'];
  if (required.some(field => !Object.hasOwn(record,field)) || Object.keys(record).some(field => !allowed.includes(field))) invalid();
  const text = (field: string, max: number): string => {
    const item = record[field];
    if (typeof item !== 'string' || item.length < 1 || item.length > max || item.trim().length === 0) invalid();
    const result = item as string;
    for (let i=0;i<result.length;i++) if (result.charCodeAt(i)<32 || result.charCodeAt(i)===127) invalid();
    return result;
  };
  const endpointText=text('endpoint',2048), region=text('region',80), bucket=text('bucket',63);
  let endpoint: URL;
  try { endpoint=new URL(endpointText); } catch { return invalid(); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      !/^[A-Za-z0-9-]{1,80}$/.test(region) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) invalid();
  const accessKeyId=text('accessKeyId',256), secretAccessKey=text('secretAccessKey',4096);
  const sessionToken=record.sessionToken === undefined ? undefined : text('sessionToken',16384);
  const deadline=record.deadlineMs === undefined ? 30000 : record.deadlineMs;
  if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline<100 || deadline>120000) invalid();
  const tlsCaPem=record.tlsCaPem;
  if (tlsCaPem !== undefined) {
    if (typeof tlsCaPem !== 'string' || tlsCaPem.length>16384 || tlsCaPem.trim().length===0) invalid();
    const pem=tlsCaPem as string, pattern=/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    const certificates=pem.match(pattern);
    if (certificates === null || pem.replace(pattern,'').trim().length !== 0) invalid();
    try { for (const certificate of certificates as string[]) new X509Certificate(certificate); } catch { return invalid(); }
  }
  return { endpoint:endpoint.origin,region,bucket,accessKeyId,secretAccessKey,
    deadlineMs:deadline as number, ...(sessionToken !== undefined ? {sessionToken} : {}),
    ...(tlsCaPem !== undefined ? {tlsCaPem:tlsCaPem as string} : {}) };
}
export function s3Inputs(value: unknown): RemoteRecoveryInputs {
  const config=validateS3Config(value), endpoint=new URL(config.endpoint), deadlineMs=config.deadlineMs ?? 30000;
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
        maxAttempts:2, retryMode:'standard', defaultsMode:'standard', followRegionRedirects:false,
        useFipsEndpoint:false, useDualstackEndpoint:false, useArnRegion:false, disableS3ExpressSessionAuth:true,
        authSchemePreference:['aws.auth#sigv4'], requestChecksumCalculation:'WHEN_REQUIRED', responseChecksumValidation:'WHEN_REQUIRED',
        credentialDefaultProvider:() => () => Promise.reject(Error('recovery_s3_credentials_required')), requestHandler:{ httpsAgent:agent, connectionTimeout:Math.min(deadlineMs,5000), requestTimeout:deadlineMs, throwOnRequestTimeout:true } });
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
