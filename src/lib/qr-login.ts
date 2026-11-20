import {createHash} from 'node:crypto';
import {observeMobileStatus} from './mobile-auth/mobile-auth-wait.js';
import type {HttpClient} from './client.js';
import {getActiveProfileName, getProfile, invalidateProfileCache, mutateProfileAuthentication, setRuntimeProfile,
  authenticationFingerprint, beginProfileAuthentication, cancelProfileAuthentication, type Profile, type StoredCliRecovery} from './config.js';
import {getRuntimeProfile} from './config/store.js';
import {getVersion} from './version.js';
import {deviceBytes, parseDeviceBytes} from './device-login/mobile-device-login.js';
import {openDeviceKey, type DeviceEnvelopeContext} from './device-login/device-key-envelope.js';

export interface QrLoginPending {locator: string; origin: string; expiresAt: number; rememberIphone?: boolean}
export interface QrLoginOptions {signal?: AbortSignal; rememberIphone?: boolean | 'auto'; expectedPreference?: 'auto' | 'off' | null;
  beforeStart?: (expectedFingerprint: string) => Promise<Profile>; onPending: (view: QrLoginPending) => void | Promise<void>}
export interface QrLoginUser {id: string; username: string; role: string; tenantId: string | null; mfaVerified: boolean}
export interface RecoveryReceipt {profileName: string; authGeneration: string; grantId: string; expiresAtSec: number; origin: string; tlsSpkiSha256?: string | null; insecure?: boolean}
export type QrLoginResult = {success: true; user: QrLoginUser; recoveryReceipt?: RecoveryReceipt} | {success: false; error: string; statusCode?: number; errorCode?: string; retryAfterSeconds?: number};
export type QrLoginPeer = Pick<HttpClient, 'getBaseUrl' | 'request'> & Partial<Pick<HttpClient, 'getTlsSpkiSha256' | 'getInsecure' | 'openEventStream'>>;
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

/** Read-only admission check; callers may retire a prior recovery only after this succeeds. */
export async function preflightQrLogin(peer: QrLoginPeer, options: {signal?: AbortSignal; check?: () => void} = {}): Promise<Record<string, unknown>> {
  options.check?.();options.signal?.throwIfAborted();
  const origin = cliLoginOrigin(peer.getBaseUrl());
  const protocol = row(await peer.request<unknown>({method:'GET',path:base+'/protocol',skipAuth:true,skipAuthRefresh:true,
    ...(options.signal ? {signal:options.signal} : {}),...(options.check ? {sessionGuard:options.check} : {}),
    headers:{'User-Agent':'znvault-cli/'+getVersion()}}));
  options.signal?.throwIfAborted();options.check?.();
  const capability = row(protocol.deviceLogin);
  if (protocol.protocolVersion !== 3 || capability.version !== 1 || capability.enabled !== true) {
    fail('Device sign-in is not enabled on this Vault.');
  }
  const waitEvents = row(protocol.waitEvents ?? {});
  if (waitEvents.version !== 1 || waitEvents.enabled !== true || !peer.openEventStream) {
    fail('Live authentication events are unavailable. Explicitly retry or use password/TOTP.');
  }
  if (protocol.origin !== origin || !uuid.test(text(protocol.installationId))) fail();
  return protocol;
}

/** A terminal initiator of the existing protocol; Vault remains the session/authority owner. */
export async function qrLogin(peer: QrLoginPeer, options: QrLoginOptions): Promise<QrLoginResult> {
  const previous = getRuntimeProfile(), profileName = getActiveProfileName();
  const controller = new AbortController();
  let attempt: Attempt | undefined, privateKey: CryptoKey | undefined, keyBytes: Uint8Array<ArrayBuffer> | undefined;
  let transferOwner: {userId: string; tenantId: string} | undefined;
  let rememberIphone = false;
  let completed = false, stored = false, origin = '', snapshot: string | undefined, generation: string | undefined;
  const initialPin = peer.getTlsSpkiSha256?.();
  const initialInsecure = peer.getInsecure?.();
  let expectedPreference = options.expectedPreference;
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
    if (options.rememberIphone !== undefined && options.rememberIphone !== false && ['ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => process.env[key] !== undefined)) fail('Remembering an iPhone requires an interactive user login without environment credentials.');
    origin = cliLoginOrigin(profile.url);
    if (cliLoginOrigin(peer.getBaseUrl()) !== origin) fail('QR sign-in profile or Vault changed. Start again.');
    snapshot = authenticationFingerprint(profile);
    setRuntimeProfile(profileName);
    const check = (current?: Profile): void => {
      if (controller.signal.aborted || Date.now() >= deadline) fail(controller.signal.reason === 'expired' || Date.now() >= deadline ? 'QR sign-in expired. Start again.' : 'QR sign-in cancelled.');
      if (expectedPreference !== undefined && ((current ?? getProfile(profileName))?.cliRecoveryPreference ?? null) !== expectedPreference) {
        fail('CLI recovery preference changed. Start login again.');
      }
      if (getActiveProfileName() !== profileName || process.env.ZNVAULT_API_KEY || authenticationFingerprint(current ?? getProfile(profileName)) !== snapshot ||
          peer.getTlsSpkiSha256?.() !== initialPin || peer.getInsecure?.() !== initialInsecure) {
        fail('QR sign-in profile or session changed. Start again.');
      }
      invalidateProfileCache(profileName);
      if (cliLoginOrigin(peer.getBaseUrl()) !== origin) fail('QR sign-in profile or Vault changed. Start again.');
    };
    const request = async (action: string, body?: unknown): Promise<unknown> => {
      check();
      const value = await peer.request<unknown>({method: action === 'protocol' ? 'GET' : 'POST',
        path: base + (action === 'protocol' ? '/protocol' : '/device-login/' + action),
        ...(body === undefined ? {} : {body}), skipAuth: true, skipAuthRefresh: true, signal: controller.signal,
        headers: {'User-Agent': 'znvault-cli/' + getVersion()}, sessionGuard: () => {check();}});
      check(); return value;
    };
    timer = setTimeout(expire, deadline - Date.now());
    const protocol = await preflightQrLogin(peer,{signal:controller.signal,check});
    const openEvents = peer.openEventStream?.bind(peer);
    if (!openEvents) fail('Live authentication events are unavailable. Explicitly retry or use password/TOTP.');
    if (options.rememberIphone !== undefined && options.rememberIphone !== false) {
      let available = false;
      if (Object.hasOwn(protocol, 'cliRecovery')) {
        const recovery = row(protocol.cliRecovery);
        if (recovery.version !== 1 || typeof recovery.enabled !== 'boolean') fail();
        available = recovery.enabled;
      }
      if (options.rememberIphone === true && !available) fail('CLI recovery is not enabled on this Vault.');
      rememberIphone = available;
    }
    if (profile.cliRecovery?.state === 'active' && profile.cliRecovery.installationId !== protocol.installationId) {
      fail('The remembered iPhone belongs to a different Vault installation. Verify the original installation before retiring this binding; use a separate profile for this Vault.');
    }
    if (options.beforeStart) {
      check();
      const prepared = await options.beforeStart(snapshot);
      snapshot = authenticationFingerprint(prepared);
      expectedPreference = prepared.cliRecoveryPreference ?? null;
    }
    const begun = beginProfileAuthentication(profileName, current => {check(current);});
    generation = begun.authGeneration;snapshot = authenticationFingerprint(begun);
    const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveBits']);
    privateKey = pair.privateKey;
    const publicPoint = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const started = row(await request('start', {browserPublicKey: deviceBytes(publicPoint), ...(rememberIphone ? {rememberIphone: true} : {})}));
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
    await options.onPending({locator: locator.toString(), origin, expiresAt: Math.floor(deadline / 1000), rememberIphone});
    check();
    const proof = {requestId: attempt.requestId, claimant: attempt.claimant};
    for await (const value of observeMobileStatus({requestId:attempt.requestId,expiresAt:deadline,signal:controller.signal,
      openEvents:(afterRevision,signal)=>{check();return openEvents(base+'/device-login/events',
        {...proof,...(afterRevision === undefined ? {} : {afterRevision})},{signal,skipAuth:true,
          sessionGuard:()=>{check();},headers:{'User-Agent':'znvault-cli/'+getVersion()}});},
      readStatus:async()=>await request('status',proof)})) {
      const status = row(value);
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
          rememberIphone ? {origin, installationId: attempt.installationId} : undefined);
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
    }
    return fail('QR sign-in ended. Explicitly retry.');
  } catch (error) {
    const message = controller.signal.reason === 'expired' ? 'QR sign-in expired. Start again.' : controller.signal.aborted ? 'QR sign-in cancelled.' :
      error instanceof Error && error.message === 'MOBILE_AUTH_EVENTS_DISCONNECTED' ? 'Live authentication events disconnected. Explicitly retry QR sign-in; no session was stored.' :
      error instanceof Error && error.message.startsWith('MOBILE_AUTH_EVENTS_') ? 'Live authentication events are unavailable. Explicitly retry or use password/TOTP; no session was stored.' :
      error !== null && typeof error === 'object' && 'code' in error && error.code === 'CLI_RECOVERY_RETIREMENT_PENDING' ?
        'Local session cleared. CLI recovery retirement is pending on its original Vault; retry logout when it is reachable.' :
      error instanceof QrLoginError ? error.message : 'QR sign-in could not finish. Start again; no session was stored.';
    return {success: false, error: message};
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    keyBytes?.fill(0); privateKey = undefined;
    if (attempt && !completed) {
      try {
        if (authenticationFingerprint(getProfile(profileName)) === snapshot && cliLoginOrigin(peer.getBaseUrl()) === origin &&
            peer.getTlsSpkiSha256?.() === initialPin && peer.getInsecure?.() === initialInsecure) {
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
