/** Portable wire primitives only. Factor verification, identity and permissions stay on the server. */
export const DEVICE_LOGIN_VERSION = 1;
export const DEVICE_LOGIN_TTL_SECONDS = 120;
export const DEVICE_LOGIN_WIRE_LIMIT = 16_384;
export interface AgreementPublicJwk {kty: 'EC'; crv: 'P-256'; x: string; y: string}
export interface ActivationAttempt {requestId: string; deviceId: string; claimant: string; expiresAt: number; bindingId: string}

export function deviceBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function parseDeviceBytes(input: unknown, minimum: number, maximum = minimum): Uint8Array<ArrayBuffer> {
  if (typeof input !== 'string' || input.length > DEVICE_LOGIN_WIRE_LIMIT || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('Invalid device bytes');
  const bytes = Uint8Array.from(atob(input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4)), c => c.charCodeAt(0));
  if (bytes.length < minimum || bytes.length > maximum || deviceBytes(bytes) !== input) throw new Error('Invalid device bytes');
  return bytes;
}

export function agreementPublicJwk(input: unknown): AgreementPublicJwk {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid device public key');
  const key = input as Record<string, unknown>;
  if (key.kty !== 'EC' || key.crv !== 'P-256' || key.d !== undefined) throw new Error('Invalid device public key');
  return {kty: 'EC', crv: 'P-256', x: deviceBytes(parseDeviceBytes(key.x, 32)), y: deviceBytes(parseDeviceBytes(key.y, 32))};
}

export function agreementPublicPoint(input: unknown): Uint8Array<ArrayBuffer> {
  const key = agreementPublicJwk(input), bytes = new Uint8Array(65);
  bytes[0] = 4;bytes.set(parseDeviceBytes(key.x, 32), 1);bytes.set(parseDeviceBytes(key.y, 32), 33);
  return bytes;
}

export function agreementJwkFromPoint(input: Uint8Array): AgreementPublicJwk {
  if (input.length !== 65 || input[0] !== 4) throw new Error('Invalid device public key');
  return {kty: 'EC', crv: 'P-256', x: deviceBytes(input.subarray(1, 33)), y: deviceBytes(input.subarray(33, 65))};
}
