/**
 * Consumer-side HPKE for Dynamic Secrets Recovery Fence v1.
 *
 * The X25519 private key is a process-local CryptoKey. It is never serialized,
 * written to disk, printed, placed in argv, or copied into the environment.
 */

import {createHash, timingSafeEqual} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {Chacha20Poly1305} from '@hpke/chacha20poly1305';
import {CipherSuite, HkdfSha256} from '@hpke/core';
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519';
import type {
  MintOperation,
  RecoveryHpkeCredential,
  RecoveryHpkeEnvelope,
  RecoveryPrivilegeOverlay,
} from '../dynamic-secrets/recovery-types.js';

const DELIVERY_FORMAT = 'hpke-v1' as const;
const SUITE_NAME = 'X25519-HKDF-SHA256-ChaCha20Poly1305' as const;
const INFO = 'znvault.dynsec.recovery-credential.hpke-v1';
const AAD_SCHEMA = 'znvault.dynsec.recovery-credential-aad.v1';
const CREDENTIAL_SCHEMA = 'znvault.dynsec.recovery-credential.v1';
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const utf8 = new TextDecoder('utf-8', {fatal: true});

export interface EphemeralRecoveryRecipient {
  readonly recipientPublicKey: string;
  readonly recipientKeyId: string;
  readonly privateKey: CryptoKey;
}

interface RecoveryKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

interface RecoveryKem {
  generateKeyPair: () => Promise<RecoveryKeyPair>;
  serializePublicKey: (key: CryptoKey) => Promise<ArrayBuffer>;
}

export interface RecoveryCredentialPlaintext {
  schema: typeof CREDENTIAL_SCHEMA;
  version: 1;
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
  expiresAt: string;
}

interface RecoveryHpkeAad {
  schema: typeof AAD_SCHEMA;
  version: 1;
  deliveryFormat: typeof DELIVERY_FORMAT;
  suite: typeof SUITE_NAME;
  tenantId: string;
  roleId: string;
  fenceId: string;
  fenceEpoch: number;
  permitId: string;
  requestId: string;
  leaseId: string;
  consumerApiKeyId: string;
  roleRevision: number;
  roleConfigSha256: string;
  grantPlanSha256: string;
  recipientKeyId: string;
  credentialExpiresAt: string;
  privilegeOverlay: RecoveryPrivilegeOverlay;
}

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value)), 'utf8');
}

function sha256KeyId(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalBase64Url(value: unknown, expectedBytes?: number, maxBytes?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL.test(value)) {
    throw new Error('Recovery HPKE response contains invalid base64url');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value
    || (expectedBytes !== undefined && decoded.length !== expectedBytes)
    || (maxBytes !== undefined && decoded.length > maxBytes)
  ) {
    decoded.fill(0);
    throw new Error('Recovery HPKE response contains non-canonical base64url');
  }
  return decoded;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Recovery HPKE response contains an invalid timestamp');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error('Recovery HPKE response contains a non-canonical timestamp');
  }
  return value;
}

function requireIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error('Recovery HPKE response contains an invalid identifier');
  }
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Recovery HPKE response contains an invalid epoch or revision');
  }
  return value;
}

function requireDigest(value: unknown, prefixed: boolean): string {
  if (typeof value !== 'string' || !(prefixed ? SHA256 : SHA256_HEX).test(value)) {
    throw new Error('Recovery HPKE response contains an invalid SHA-256 identity');
  }
  return value;
}

function requireOverlay(value: unknown): RecoveryPrivilegeOverlay {
  if (value !== 'NONE' && value !== 'MYSQL_SCHEMA_LOCK_TABLES') {
    throw new Error('Recovery HPKE response contains an invalid privilege overlay');
  }
  return value;
}

function parseAad(raw: Buffer): RecoveryHpkeAad {
  if (raw.length === 0 || raw.length > 16_384) throw new Error('Recovery HPKE AAD is too large');
  let candidate: unknown;
  try {
    candidate = JSON.parse(utf8.decode(raw)) as unknown;
  } catch {
    throw new Error('Recovery HPKE AAD is not valid UTF-8 JSON');
  }
  const keys = [
    'schema', 'version', 'deliveryFormat', 'suite', 'tenantId', 'roleId',
    'fenceId', 'fenceEpoch', 'permitId', 'requestId', 'leaseId',
    'consumerApiKeyId', 'roleRevision', 'roleConfigSha256', 'grantPlanSha256',
    'recipientKeyId', 'credentialExpiresAt', 'privilegeOverlay',
  ] as const;
  if (
    !isRecord(candidate)
    || !hasExactKeys(candidate, keys)
    || candidate.schema !== AAD_SCHEMA
    || candidate.version !== 1
    || candidate.deliveryFormat !== DELIVERY_FORMAT
    || candidate.suite !== SUITE_NAME
  ) {
    throw new Error('Recovery HPKE AAD has an invalid contract shape');
  }
  if (!canonicalJsonBytes(candidate).equals(raw)) {
    throw new Error('Recovery HPKE AAD is not canonical JSON');
  }
  return {
    schema: AAD_SCHEMA,
    version: 1,
    deliveryFormat: DELIVERY_FORMAT,
    suite: SUITE_NAME,
    tenantId: requireIdentifier(candidate.tenantId),
    roleId: requireIdentifier(candidate.roleId),
    fenceId: requireIdentifier(candidate.fenceId),
    fenceEpoch: requirePositiveInteger(candidate.fenceEpoch),
    permitId: requireIdentifier(candidate.permitId),
    requestId: requireIdentifier(candidate.requestId),
    leaseId: requireIdentifier(candidate.leaseId),
    consumerApiKeyId: requireIdentifier(candidate.consumerApiKeyId),
    roleRevision: requirePositiveInteger(candidate.roleRevision),
    roleConfigSha256: requireDigest(candidate.roleConfigSha256, false),
    grantPlanSha256: requireDigest(candidate.grantPlanSha256, false),
    recipientKeyId: requireDigest(candidate.recipientKeyId, true),
    credentialExpiresAt: canonicalTimestamp(candidate.credentialExpiresAt),
    privilegeOverlay: requireOverlay(candidate.privilegeOverlay),
  };
}

function assertEnvelope(value: RecoveryHpkeEnvelope): void {
  const candidate: unknown = value;
  if (
    !isRecord(candidate)
    || !hasExactKeys(candidate, ['version', 'suite', 'enc', 'ciphertext', 'aadSha256'])
    || candidate.version !== DELIVERY_FORMAT
    || candidate.suite !== SUITE_NAME
  ) {
    throw new Error('Recovery HPKE envelope has an invalid contract shape');
  }
  requireDigest(candidate.aadSha256, true);
}

function assertBoundAad(
  aad: RecoveryHpkeAad,
  operation: MintOperation,
  recipient: EphemeralRecoveryRecipient,
): void {
  const exactBindings = [
    [aad.tenantId, operation.tenantId, 'tenant'],
    [aad.roleId, operation.roleId, 'role'],
    [aad.fenceId, operation.fenceId, 'fence'],
    [aad.permitId, operation.permitId, 'permit'],
    [aad.requestId, operation.requestId, 'request'],
    [aad.leaseId, operation.leaseId, 'lease'],
    [aad.roleConfigSha256, operation.roleConfigSha256, 'role digest'],
    [aad.grantPlanSha256, operation.grantPlanSha256, 'grant-plan digest'],
    [aad.recipientKeyId, recipient.recipientKeyId, 'recipient'],
    [aad.credentialExpiresAt, operation.credentialExpiresAt, 'expiry'],
    [aad.privilegeOverlay, operation.privilegeOverlay, 'privilege overlay'],
    [aad.consumerApiKeyId, operation.consumerApiKeyId, 'consumer API key'],
  ] as const;
  for (const [actual, expected, name] of exactBindings) {
    if (actual !== expected) throw new Error(`Recovery HPKE ${name} binding does not match the operation`);
  }
  if (aad.fenceEpoch !== operation.fenceEpoch || aad.roleRevision !== operation.roleRevision) {
    throw new Error('Recovery HPKE epoch or role revision binding does not match the operation');
  }
}

function safeOptionValue(value: unknown, field: string, maxLength: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || /[\0\r\n]/.test(value)
  ) {
    throw new Error(`Decrypted recovery credential has an invalid ${field}`);
  }
  return value;
}

function parseCredential(raw: Buffer, expectedExpiresAt: string): RecoveryCredentialPlaintext {
  let candidate: unknown;
  try {
    candidate = JSON.parse(utf8.decode(raw)) as unknown;
  } catch {
    throw new Error('Decrypted recovery credential is not valid UTF-8 JSON');
  }
  const keys = ['schema', 'version', 'username', 'password', 'host', 'port', 'database', 'expiresAt'] as const;
  if (
    !isRecord(candidate)
    || !hasExactKeys(candidate, keys)
    || candidate.schema !== CREDENTIAL_SCHEMA
    || candidate.version !== 1
    || !canonicalJsonBytes(candidate).equals(raw)
    || !Number.isSafeInteger(candidate.port)
    || (candidate.port as number) < 1
    || (candidate.port as number) > 65_535
  ) {
    throw new Error('Decrypted recovery credential has an invalid contract shape');
  }
  const expiresAt = canonicalTimestamp(candidate.expiresAt);
  if (expiresAt !== expectedExpiresAt) {
    throw new Error('Decrypted recovery credential expiry does not match authenticated metadata');
  }
  return {
    schema: CREDENTIAL_SCHEMA,
    version: 1,
    username: safeOptionValue(candidate.username, 'username', 255),
    password: safeOptionValue(candidate.password, 'password', 4_096),
    host: safeOptionValue(candidate.host, 'host', 255),
    port: candidate.port as number,
    database: safeOptionValue(candidate.database, 'database', 255),
    expiresAt,
  };
}

export async function generateEphemeralRecoveryRecipient(): Promise<EphemeralRecoveryRecipient> {
  const hpke = suite();
  // The packages expose the KEM methods at runtime, while their nested type is
  // intentionally abstract. Narrow the two methods this consumer needs.
  const kem = hpke.kem as unknown as RecoveryKem;
  const keyPair = await kem.generateKeyPair();
  const rawPublicKey = Buffer.from(await kem.serializePublicKey(keyPair.publicKey));
  try {
    if (rawPublicKey.length !== 32 || rawPublicKey.every(byte => byte === 0)) {
      throw new Error('Failed to generate a valid ephemeral X25519 recipient');
    }
    return Object.freeze({
      recipientPublicKey: rawPublicKey.toString('base64url'),
      recipientKeyId: sha256KeyId(rawPublicKey),
      privateKey: keyPair.privateKey,
    });
  } finally {
    rawPublicKey.fill(0);
  }
}

export async function openRecoveryCredential(input: {
  delivery: RecoveryHpkeCredential;
  operation: MintOperation;
  recipient: EphemeralRecoveryRecipient;
}): Promise<RecoveryCredentialPlaintext> {
  const {delivery, operation, recipient} = input;
  const wireDelivery: unknown = delivery;
  if (
    !isRecord(wireDelivery)
    || wireDelivery.deliveryFormat !== DELIVERY_FORMAT
    || wireDelivery.permitId !== operation.permitId
    || wireDelivery.requestId !== operation.requestId
    || (wireDelivery.state !== 'CONSUMED' && wireDelivery.state !== 'DELIVERED')
  ) {
    throw new Error('Recovery credential delivery does not match the requested operation');
  }
  assertEnvelope(delivery.envelope);

  const aad = canonicalBase64Url(delivery.aad, undefined, 16_384);
  const enc = canonicalBase64Url(delivery.envelope.enc, 32);
  const ciphertext = canonicalBase64Url(delivery.envelope.ciphertext, undefined, 16_384);
  let plaintext: Buffer | undefined;
  try {
    if (ciphertext.length <= 16) throw new Error('Recovery HPKE ciphertext is too short');
    const expectedAadDigest = Buffer.from(delivery.envelope.aadSha256.slice('sha256:'.length), 'hex');
    const actualAadDigest = createHash('sha256').update(aad).digest();
    try {
      if (!timingSafeEqual(expectedAadDigest, actualAadDigest)) {
        throw new Error('Recovery HPKE envelope does not authenticate the supplied AAD');
      }
    } finally {
      expectedAadDigest.fill(0);
      actualAadDigest.fill(0);
    }

    const providedEnvelopeSha256 = requireDigest(delivery.envelopeSha256, true);
    const expectedEnvelopeDigest = Buffer.from(providedEnvelopeSha256.slice('sha256:'.length), 'hex');
    const actualEnvelopeDigest = createHash('sha256')
      .update(canonicalJsonBytes(delivery.envelope))
      .digest();
    try {
      if (!timingSafeEqual(expectedEnvelopeDigest, actualEnvelopeDigest)) {
        throw new Error('Recovery HPKE envelope digest does not match the persisted envelope');
      }
    } finally {
      expectedEnvelopeDigest.fill(0);
      actualEnvelopeDigest.fill(0);
    }

    const parsedAad = parseAad(aad);
    assertBoundAad(parsedAad, operation, recipient);
    let opened: ArrayBuffer;
    try {
      opened = await suite().open(
        {
          recipientKey: recipient.privateKey,
          enc,
          info: Buffer.from(INFO, 'utf8'),
        },
        ciphertext,
        aad,
      );
    } catch {
      throw new Error('Recovery HPKE credential authentication failed');
    }
    plaintext = Buffer.from(opened);
    return parseCredential(plaintext, parsedAad.credentialExpiresAt);
  } finally {
    aad.fill(0);
    enc.fill(0);
    ciphertext.fill(0);
    plaintext?.fill(0);
  }
}
