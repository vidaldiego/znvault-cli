import {describe, expect, it} from 'vitest';
import {createDecipheriv, createECDH, createPrivateKey, diffieHellman, hkdfSync} from 'node:crypto';
import {deviceEnvelopeAAD, deviceEnvelopeInfo, openDeviceKey, sealDeviceKey, type DeviceEnvelopeContext} from '../../src/lib/device-login/device-key-envelope.js';
import {readFile} from 'node:fs/promises';

const context: DeviceEnvelopeContext = {purpose: 'device-binding', origin: 'https://vault.example.test',
  installationId: '11111111-1111-4111-8111-111111111111', tenantId: 'public-vector', userId: 'public-human',
  deviceId: '22222222-2222-4222-8222-222222222222', bindingId: '33333333-3333-4333-8333-333333333333', authEpoch: 4, keyVersion: 2};
const transfer: DeviceEnvelopeContext = {...context, purpose: 'device-login-transfer',
  challengeId: '44444444-4444-4444-8444-444444444444', requestId: '55555555-5555-4555-8555-555555555555',
  initiatorHash: 'a'.repeat(64), browserKeyHash: 'b'.repeat(64)};
const plaintext = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 110, 4, 34, 4, 32, ...Array(32).fill(17)]);
async function recipient() {
  const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  return {pair, jwk: await crypto.subtle.exportKey('jwk', pair.publicKey)};
}

describe('one portable device-key envelope for Node and browsers', () => {
  it.each([context, transfer])('round trips $purpose and authenticates its fixed ordered context', async value => {
    const {pair, jwk} = await recipient(), sealed = await sealDeviceKey(plaintext, jwk, value);
    expect(await openDeviceKey(sealed, pair.privateKey, value)).toEqual(plaintext);
    expect(new TextDecoder().decode(deviceEnvelopeAAD(value))).toContain(value.purpose);
    expect(sealed.ephemeralPublicKey).toHaveLength(87);expect(sealed.nonce).toHaveLength(16);expect(sealed.salt).toHaveLength(43);
  });
  it('agrees with independent native Node ECDH/HKDF/GCM primitives', async () => {
    const {pair, jwk} = await recipient(), sealed = await sealDeviceKey(plaintext, jwk, context);
    const privateKey = createPrivateKey({key: Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), format: 'der', type: 'pkcs8'});
    const point = Buffer.from(sealed.ephemeralPublicKey, 'base64url');
    const publicJwk = {kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url')};
    const {createPublicKey} = await import('node:crypto');
    const shared = diffieHellman({privateKey, publicKey: createPublicKey({key: publicJwk, format: 'jwk'})});
    const key = hkdfSync('sha256', shared, Buffer.from(sealed.salt, 'base64url'), deviceEnvelopeInfo(context), 32);
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(sealed.nonce, 'base64url'));
    cipher.setAAD(deviceEnvelopeAAD(context));cipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
    expect(Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext, 'base64url')), cipher.final()])).toEqual(Buffer.from(plaintext));
  });
  it('opens the shared independent Node/CryptoKit interoperability vectors', async () => {
    const fixture = JSON.parse(await readFile(new URL('../fixtures/mobile-device-login/device-envelope-v1.json', import.meta.url), 'utf8'));
    const recipient = createECDH('prime256v1');recipient.setPrivateKey(Buffer.alloc(32, fixture.recipientSeed));
    const point = recipient.getPublicKey();
    const key = await crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'), d: recipient.getPrivateKey().toString('base64url')}, {name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveBits']);
    for (const vector of fixture.vectors) {
      expect(Buffer.from(deviceEnvelopeAAD(vector.context)).toString('base64url')).toBe(vector.aad);
      expect(Buffer.from(deviceEnvelopeInfo(vector.context)).toString('base64url')).toBe(vector.info);
      expect(await openDeviceKey(vector.envelope, key, vector.context)).toEqual(plaintext);
    }
  });
  it('cannot exchange the persistent wrapper and ephemeral transfer domains', async () => {
    const {pair, jwk} = await recipient();
    const sealed = await sealDeviceKey(plaintext, jwk, context);
    await expect(openDeviceKey(sealed, pair.privateKey, transfer)).rejects.toThrow('Invalid device key envelope');
  });
  for (const changed of [{origin: 'https://other.example.test'}, {installationId: '66666666-6666-4666-8666-666666666666'},
    {tenantId: 'other-tenant'}, {userId: 'other-human'}, {deviceId: '77777777-7777-4777-8777-777777777777'},
    {bindingId: '88888888-8888-4888-8888-888888888888'}, {authEpoch: 5}, {keyVersion: 3}]) {
    it(`authenticates ${Object.keys(changed)[0]}`, async () => {
      const {pair, jwk} = await recipient(), sealed = await sealDeviceKey(plaintext, jwk, context);
      await expect(openDeviceKey(sealed, pair.privateKey, {...context, ...changed})).rejects.toThrow('Invalid device key envelope');
    });
  }
  it('binds the transfer to the exact browser, claimant and attempt', async () => {
    const {pair, jwk} = await recipient(), sealed = await sealDeviceKey(plaintext, jwk, transfer);
    for (const changed of [{initiatorHash: 'c'.repeat(64)}, {browserKeyHash: 'd'.repeat(64)},
      {challengeId: context.bindingId}, {requestId: context.deviceId}]) {
      await expect(openDeviceKey(sealed, pair.privateKey, {...transfer, ...changed})).rejects.toThrow('Invalid device key envelope');
    }
  });
  it('rejects malformed, oversized and unauthenticated data without reflecting it', async () => {
    const {pair, jwk} = await recipient(), sealed = await sealDeviceKey(plaintext, jwk, context);
    for (const bad of [{...sealed, version: 2}, {...sealed, extra: 'private-input'}, {...sealed, salt: 'private-input'},
      {...sealed, nonce: ''}, {...sealed, tag: Buffer.alloc(16, 9).toString('base64url')},
      {...sealed, ciphertext: 'x'.repeat(20_000)}, {...sealed, ephemeralPublicKey: Buffer.alloc(65, 0).toString('base64url')}]) {
      await expect(openDeviceKey(bad, pair.privateKey, context)).rejects.toThrow('Invalid device key envelope');
    }
    await expect(sealDeviceKey(new Uint8Array(257), jwk, context)).rejects.toThrow('Invalid device key envelope');
    await expect(sealDeviceKey(plaintext, {...jwk, d: 'private-input'}, context)).rejects.toThrow('Invalid device key envelope');
    await expect(sealDeviceKey(plaintext, jwk, {...context, origin: 'http://vault.example.test'})).rejects.toThrow('Invalid device key envelope');
  });
});
