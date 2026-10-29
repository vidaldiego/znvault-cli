import {agreementPublicJwk, agreementPublicPoint, deviceBytes, parseDeviceBytes} from './mobile-device-login.js';

export type AgreementPrivateKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
interface BindingContext {
  origin: string; installationId: string; tenantId: string; userId: string; deviceId: string; bindingId: string;
  authEpoch: number; keyVersion: number;
}
export type DeviceEnvelopeContext = BindingContext & ({purpose: 'device-binding'} | {
  purpose: 'device-login-transfer'; challengeId: string; requestId: string; initiatorHash: string; browserKeyHash: string;
});
export interface DeviceKeyEnvelopeV1 {
  version: 1; ephemeralPublicKey: string; salt: string; nonce: string; ciphertext: string; tag: string;
}
const invalid = (): never => {throw new Error('Invalid device key envelope');};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const bindingFields = ['purpose', 'origin', 'installationId', 'tenantId', 'userId', 'deviceId', 'bindingId', 'authEpoch', 'keyVersion'];

/** A fixed tuple shared with CryptoKit. Never authenticate arbitrary JSON object serialization. */
export function deviceEnvelopeAAD(context: DeviceEnvelopeContext): Uint8Array<ArrayBuffer> {
  const fields = [...bindingFields, ...(context.purpose === 'device-login-transfer' ? ['challengeId', 'requestId', 'initiatorHash', 'browserKeyHash'] : [])];
  if (Object.keys(context).length !== fields.length || Object.keys(context).some(key => !fields.includes(key)) ||
    !['device-binding', 'device-login-transfer'].includes(context.purpose)) return invalid();
  for (const value of [context.tenantId, context.userId]) if (!value || value.length > 128 ||
    Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return invalid();
  for (const value of [context.installationId, context.deviceId, context.bindingId]) if (!uuid.test(value)) return invalid();
  for (const value of [context.authEpoch, context.keyVersion]) if (!Number.isSafeInteger(value) || value < 1) return invalid();
  const origin = new URL(context.origin);
  if (origin.protocol !== 'https:' || origin.origin !== context.origin || origin.username || origin.password) return invalid();
  if (context.purpose === 'device-login-transfer' && (!uuid.test(context.challengeId) || !uuid.test(context.requestId) ||
    !hash.test(context.initiatorHash) || !hash.test(context.browserKeyHash))) return invalid();
  return new TextEncoder().encode(JSON.stringify([`znvault:${context.purpose}:v1`, context.origin, context.installationId,
    context.tenantId, context.userId, context.deviceId, context.bindingId, context.authEpoch, context.keyVersion,
    ...(context.purpose === 'device-login-transfer' ? [context.challengeId, context.requestId, context.initiatorHash, context.browserKeyHash] : [])]));
}

export function deviceEnvelopeInfo(context: DeviceEnvelopeContext): Uint8Array<ArrayBuffer> {
  deviceEnvelopeAAD(context);
  return new TextEncoder().encode(`znvault:${context.purpose}:v1\0`);
}

export function parseDeviceKeyEnvelope(value: unknown): DeviceKeyEnvelopeV1 {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const row = value as Record<string, unknown>, fields = ['version', 'ephemeralPublicKey', 'salt', 'nonce', 'ciphertext', 'tag'];
    if (row.version !== 1 || Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) return invalid();
    const point = parseDeviceBytes(row.ephemeralPublicKey, 65);
    if (point[0] !== 4) return invalid();
    return {version: 1, ephemeralPublicKey: deviceBytes(point), salt: deviceBytes(parseDeviceBytes(row.salt, 32)),
      nonce: deviceBytes(parseDeviceBytes(row.nonce, 12)), ciphertext: deviceBytes(parseDeviceBytes(row.ciphertext, 1, 256)),
      tag: deviceBytes(parseDeviceBytes(row.tag, 16))};
  } catch {return invalid();}
}

async function envelopeKey(privateKey: AgreementPrivateKey, publicPoint: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>,
  context: DeviceEnvelopeContext): Promise<AgreementPrivateKey> {
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'ECDH' || !privateKey.usages.includes('deriveBits')) return invalid();
  const publicKey = await crypto.subtle.importKey('raw', publicPoint, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: publicKey}, privateKey, 256));
  try {
    const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt, info: deviceEnvelopeInfo(context)}, material,
      {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  } finally {bits.fill(0);}
}

export async function sealDeviceKey(plaintext: Uint8Array, recipientPublicKey: unknown, context: DeviceEnvelopeContext): Promise<DeviceKeyEnvelopeV1> {
  try {
    if (plaintext.length < 1 || plaintext.length > 256) return invalid();
    const aad = deviceEnvelopeAAD(context), point = agreementPublicPoint(agreementPublicJwk(recipientPublicKey));
    const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveBits']);
    const salt = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await envelopeKey(pair.privateKey, point, salt, context);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128}, key, new Uint8Array(plaintext)));
    return {version: 1, ephemeralPublicKey: deviceBytes(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
      salt: deviceBytes(salt), nonce: deviceBytes(nonce), ciphertext: deviceBytes(sealed.subarray(0, -16)), tag: deviceBytes(sealed.subarray(-16))};
  } catch {return invalid();}
}

export async function openDeviceKey(input: unknown, recipientPrivateKey: AgreementPrivateKey, context: DeviceEnvelopeContext): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const value = parseDeviceKeyEnvelope(input), aad = deviceEnvelopeAAD(context);
    const key = await envelopeKey(recipientPrivateKey, parseDeviceBytes(value.ephemeralPublicKey, 65), parseDeviceBytes(value.salt, 32), context);
    const ciphertext = parseDeviceBytes(value.ciphertext, 1, 256), sealed = new Uint8Array(ciphertext.length + 16);
    sealed.set(ciphertext);sealed.set(parseDeviceBytes(value.tag, 16), ciphertext.length);
    return new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: parseDeviceBytes(value.nonce, 12),
      additionalData: aad, tagLength: 128}, key, sealed));
  } catch {return invalid();}
}
