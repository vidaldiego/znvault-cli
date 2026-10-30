import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpClient} from './client.js';
import {getActiveProfileName, getProfile, invalidateProfileCache, mutateProfileAuthentication, setRuntimeProfile,
  authenticationFingerprint, beginProfileAuthentication, cancelProfileAuthentication, type Profile, type StoredCliRecovery} from './config.js';
import {getRuntimeProfile} from './config/store.js';
import {getVersion} from './version.js';
import {deviceBytes, parseDeviceBytes} from './device-login/mobile-device-login.js';
import {openDeviceKey, type DeviceEnvelopeContext} from './device-login/device-key-envelope.js';

export interface QrLoginPending {locator: string; origin: string; expiresAt: number}
export interface QrLoginOptions {signal?: AbortSignal; rememberIphone?: boolean; onPending: (view: QrLoginPending) => void | Promise<void>}
export interface QrLoginUser {id: string; username: string; role: string; tenantId: string | null; mfaVerified: boolean}
export type QrLoginResult = {success: true; user: QrLoginUser} | {success: false; error: string};
export type QrLoginPeer = Pick<HttpClient, 'getBaseUrl' | 'request'> & Partial<Pick<HttpClient, 'getTlsSpkiSha256'>>;
interface Attempt {requestId: string; claimant: string; expiresAt: number; origin: string; installationId: string}
export interface CliLoginResponse {accessToken: string; refreshToken: string; expiresIn: number; userSealedUnlocked: boolean; user: QrLoginUser; cliRecovery?: StoredCliRecovery}
const base = '/auth/mfa/iphone', uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalidMessage = 'Invalid QR sign-in response. Start again.';
class QrLoginError extends Error {}
function fail(message = invalidMessage): never {throw new QrLoginError(message);}
function row(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 128): string {
  if (typeof value !== 'string' || !value || value.length > limit ||
      Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return fail();
  return value;
}
export function cliLoginOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return fail('QR sign-in requires a configured HTTPS Vault origin.');
  return url.origin;
}
export function parseCliLoginResponse(value: unknown, enrollment?: {origin: string; installationId: string}): CliLoginResponse {
  const result = row(value), user = row(result.user);
  if (typeof result.userSealedUnlocked !== 'boolean' || !Number.isSafeInteger(result.expiresIn) || Number(result.expiresIn) < 1 || Number(result.expiresIn) > 31_536_000 ||
      !['user', 'admin', 'superadmin'].includes(text(user.role))) return fail();
  let cliRecovery: StoredCliRecovery | undefined;
  if (enrollment) {
    const grant = row(result.cliRecovery);
    const credential = text(grant.credential);
    const decoded = parseDeviceBytes(credential, 32);
    if (deviceBytes(decoded) !== credential || !uuid.test(text(grant.grantId)) || grant.origin !== enrollment.origin ||
        grant.installationId !== enrollment.installationId || !Number.isSafeInteger(grant.expiresAtSec) ||
        Number(grant.expiresAtSec) <= Date.now()/1000 || Number(grant.expiresAtSec) > Date.now()/1000 + 2592001) fail();
    cliRecovery = {state: 'active', grantId: text(grant.grantId), credential, origin: enrollment.origin,
      installationId: enrollment.installationId, expiresAtSec: Number(grant.expiresAtSec)};
  } else if (Object.hasOwn(result, 'cliRecovery')) fail();
  return {accessToken: text(result.accessToken, 16_384), refreshToken: text(result.refreshToken, 16_384),
    expiresIn: Number(result.expiresIn), userSealedUnlocked: result.userSealedUnlocked, user: {id: text(user.id), username: text(user.username),
      role: text(user.role), tenantId: user.tenantId === null ? null : text(user.tenantId), mfaVerified: true}, ...(cliRecovery ? {cliRecovery} : {})};
}
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** A terminal initiator of the existing protocol; Vault remains the session/authority owner. */
export async function qrLogin(peer: QrLoginPeer, options: QrLoginOptions): Promise<QrLoginResult> {
  const previous = getRuntimeProfile(), profileName = getActiveProfileName();
  const controller = new AbortController();
  let attempt: Attempt | undefined, privateKey: CryptoKey | undefined, keyBytes: Uint8Array<ArrayBuffer> | undefined;
  let transferOwner: {userId: string; tenantId: string} | undefined;
  let completed = false, stored = false, origin = '', snapshot: string | undefined, generation: string | undefined;
  const initialPin = peer.getTlsSpkiSha256?.();
  let deadline = Date.now() + 120_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {controller.abort('cancelled');};
  const expire = (): void => {controller.abort('expired');};
  options.signal?.addEventListener('abort', cancel, {once: true});
  if (options.signal?.aborted) cancel();
  try {
    if (controller.signal.aborted) fail('QR sign-in cancelled.');
    const profile = getProfile(profileName);
    if (!profile || profile.apiKey || process.env.ZNVAULT_API_KEY) fail('QR sign-in requires a user profile without an API key.');
    if (options.rememberIphone && ['ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => process.env[key] !== undefined)) fail('Remembering an iPhone requires an interactive user login without environment credentials.');
    origin = cliLoginOrigin(profile.url);
    if (cliLoginOrigin(peer.getBaseUrl()) !== origin) fail('QR sign-in profile or Vault changed. Start again.');
    snapshot = authenticationFingerprint(profile);
    setRuntimeProfile(profileName);
    const check = (current?: Profile): void => {
      if (controller.signal.aborted || Date.now() >= deadline) fail(controller.signal.reason === 'expired' || Date.now() >= deadline ? 'QR sign-in expired. Start again.' : 'QR sign-in cancelled.');
      if (getActiveProfileName() !== profileName || process.env.ZNVAULT_API_KEY || authenticationFingerprint(current ?? getProfile(profileName)) !== snapshot ||
          peer.getTlsSpkiSha256?.() !== initialPin) {
        fail('QR sign-in profile or session changed. Start again.');
      }
      invalidateProfileCache(profileName);
      if (cliLoginOrigin(peer.getBaseUrl()) !== origin) fail('QR sign-in profile or Vault changed. Start again.');
    };
    const begun = beginProfileAuthentication(profileName, current => {check(current);});
    generation = begun.authGeneration;snapshot = authenticationFingerprint(begun);
    const request = async (action: string, body?: unknown): Promise<unknown> => {
      check();
      const value = await peer.request<unknown>({method: action === 'protocol' ? 'GET' : 'POST',
        path: base + (action === 'protocol' ? '/protocol' : '/device-login/' + action),
        ...(body === undefined ? {} : {body}), skipAuth: true, skipAuthRefresh: true, signal: controller.signal,
        headers: {'User-Agent': 'znvault-cli/' + getVersion()}, sessionGuard: () => {check();}});
      check(); return value;
    };
    timer = setTimeout(expire, deadline - Date.now());
    const protocol = row(await request('protocol'));
    const capability = row(protocol.deviceLogin);
    if (protocol.protocolVersion !== 3 || capability.version !== 1 || capability.enabled !== true) {
      fail('Device sign-in is not enabled on this Vault.');
    }
    if (protocol.origin !== origin || !uuid.test(text(protocol.installationId))) fail();
    if (options.rememberIphone) {
      const recovery = row(protocol.cliRecovery);
      if (recovery.version !== 1 || recovery.enabled !== true) fail('CLI recovery is not enabled on this Vault.');
    }
    const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveBits']);
    privateKey = pair.privateKey;
    const publicPoint = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const started = row(await request('start', {browserPublicKey: deviceBytes(publicPoint), ...(options.rememberIphone ? {rememberIphone: true} : {})}));
    if (started.origin !== origin || started.installationId !== protocol.installationId || !uuid.test(text(started.requestId)) ||
        !Number.isSafeInteger(started.expiresAt) || Number(started.expiresAt) * 1000 <= Date.now() ||
        Number(started.expiresAt) * 1000 > Date.now() + 121_000) fail();
    parseDeviceBytes(started.claimant, 32);
    attempt = {origin, installationId: text(started.installationId), requestId: text(started.requestId),
      claimant: text(started.claimant), expiresAt: Number(started.expiresAt)};
    deadline = Math.min(deadline, attempt.expiresAt * 1000);
    clearTimeout(timer); timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
    const locator = new URL('znvault-authenticator://login');
    locator.searchParams.set('v', '1'); locator.searchParams.set('origin', origin);
    locator.searchParams.set('installationId', attempt.installationId); locator.searchParams.set('challengeId', attempt.requestId);
    await options.onPending({locator: locator.toString(), origin, expiresAt: Math.floor(deadline / 1000)});
    check();
    const proof = {requestId: attempt.requestId, claimant: attempt.claimant};
    for (;;) {
      const status = row(await request('status', proof));
      if (status.expiresAt !== attempt.expiresAt) fail();
      if (status.state === 'approved') {
        if (status.transferContext !== undefined) {
          const context = row(status.transferContext);
          if (context.purpose !== 'device-login-transfer' || context.origin !== origin || context.installationId !== attempt.installationId ||
              context.challengeId !== attempt.requestId || context.browserKeyHash !== hash(publicPoint) ||
              context.initiatorHash !== hash(new TextEncoder().encode(attempt.claimant))) fail();
          const encoded = parseDeviceBytes(status.transfer, 1, 8192);
          const envelope: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(encoded));
          keyBytes = await openDeviceKey(envelope, privateKey, context as unknown as DeviceEnvelopeContext);
          transferOwner = {userId: text(context.userId), tenantId: text(context.tenantId)};
        } else if (status.transfer !== undefined && status.transfer !== '') fail();
        check();
        const tokens = parseCliLoginResponse(await request('complete', {...proof, ...(keyBytes ? {keyBytes: deviceBytes(keyBytes)} : {})}),
          options.rememberIphone ? {origin, installationId: attempt.installationId} : undefined);
        completed = true;
        if ((tokens.user.tenantId !== null) !== (keyBytes !== undefined) || tokens.userSealedUnlocked !== (keyBytes !== undefined) ||
            (transferOwner && (tokens.user.id !== transferOwner.userId || tokens.user.tenantId !== transferOwner.tenantId))) fail();
        check();
        mutateProfileAuthentication(profileName, current => {
          check(current);
          return {...current, credentials: {accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000, userId: tokens.user.id, username: tokens.user.username,
            role: tokens.user.role, tenantId: tokens.user.tenantId}, ...(tokens.cliRecovery ? {cliRecovery: tokens.cliRecovery} : {})};
        });
        stored = true;
        return {success: true, user: tokens.user};
      }
      if (status.state === 'denied') fail('QR sign-in was denied.');
      if (status.state === 'expired') fail('QR sign-in expired. Start again.');
      if (status.state === 'cancelled') fail('QR sign-in cancelled.');
      if (status.state !== 'pending' && status.state !== 'claimed') fail();
      await delay(Math.min(1000, Math.max(0, deadline - Date.now())), undefined, {signal: controller.signal});
    }
  } catch (error) {
    const message = controller.signal.reason === 'expired' ? 'QR sign-in expired. Start again.' : controller.signal.aborted ? 'QR sign-in cancelled.' :
      error instanceof QrLoginError ? error.message : 'QR sign-in could not finish. Start again; no session was stored.';
    return {success: false, error: message};
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    keyBytes?.fill(0); privateKey = undefined;
    if (attempt && !completed) {
      try {
        if (authenticationFingerprint(getProfile(profileName)) === snapshot && cliLoginOrigin(peer.getBaseUrl()) === origin &&
            peer.getTlsSpkiSha256?.() === initialPin) {
          await peer.request({method: 'POST', path: base + '/device-login/cancel',
            body: {requestId: attempt.requestId, claimant: attempt.claimant}, skipAuth: true, skipAuthRefresh: true,
            headers: {'User-Agent': 'znvault-cli/' + getVersion()}, signal: AbortSignal.timeout(1000)});
        }
      } catch { /* Best effort, original deadline remains authoritative. */ }
    }
    if (!stored && generation !== undefined) cancelProfileAuthentication(profileName, generation);
    setRuntimeProfile(previous); invalidateProfileCache(profileName);
  }
}
