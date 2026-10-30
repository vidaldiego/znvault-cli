import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {HttpClient} from './client/http.js';
import {client} from './client.js';
import {getRuntimeProfile} from './config/store.js';
import {authenticationFingerprint, beginProfileAuthentication, cancelProfileAuthentication, getActiveProfileName,
  getProfile, invalidateProfileCache, mutateProfileAuthentication, setRuntimeProfile, type Profile, type StoredCliRecovery} from './config.js';
import {cliLoginOrigin, parseCliLoginResponse, type QrLoginPeer, type QrLoginResult} from './qr-login.js';
import {getVersion} from './version.js';

export interface RecoverCliOptions {
  signal?: AbortSignal;
  onPending: (pending: {comparisonNumber: string; expiresAtSec: number; origin: string}) => Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
class RecoveryError extends Error {}
function fail(message: string): never {throw new RecoveryError(message);}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('Invalid CLI recovery response. Start again.');
  return value as Record<string, unknown>;
}
function capability(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}
function checkedGrant(value: StoredCliRecovery, active: boolean): StoredCliRecovery {
  if (!uuid.test(value.grantId) || !capability(value.credential) || cliLoginOrigin(value.origin) !== value.origin ||
      !Number.isSafeInteger(value.expiresAtSec) || value.expiresAtSec < 1 ||
      !['active', 'revocation_pending'].includes(value.state) ||
      (active && (value.state !== 'active' || !value.installationId || !uuid.test(value.installationId) || value.expiresAtSec * 1000 <= Date.now()))) {
    return fail('No active iPhone recovery is available. Complete a normal login.');
  }
  return value;
}

/** No HTTP under the Conf lock. Failed retirement preserves only a non-usable proof. */
export async function retireStoredCliRecovery(profileName: string): Promise<void> {
  const original = getProfile(profileName);
  if (!original?.cliRecovery) return;
  const saved = checkedGrant(original.cliRecovery, false), snapshot = authenticationFingerprint(original);
  const pin = client.getTlsSpkiSha256();
  const pending: StoredCliRecovery = {state: 'revocation_pending', grantId: saved.grantId, credential: saved.credential,
    origin: saved.origin, expiresAtSec: saved.expiresAtSec};
  const generation = randomUUID();
  mutateProfileAuthentication(profileName, current => {
    if (authenticationFingerprint(current) !== snapshot) return fail('Profile changed during retirement. Retry the requested command.');
    delete current.credentials;delete current.apiKey;delete current.apiKeyId;delete current.apiKeyName;
    return {...current, authGeneration: generation, cliRecovery: pending};
  });
  try {
    // Ignore global URL/auth overrides: the proof belongs only to its stored Vault.
    const peer = new HttpClient({baseUrl: saved.origin, insecure: original.insecure, timeout: original.timeout,
      ...(pin !== null ? {tlsSpkiSha256: pin} : {})});
    const result = record(await peer.request<unknown>({method: 'POST', path: '/auth/cli/recovery/revoke',
      body: {grantId: saved.grantId, credential: saved.credential}, skipAuth: true, skipAuthRefresh: true,
      signal: AbortSignal.timeout(original.timeout)}));
    if (result.revoked !== true || client.getTlsSpkiSha256() !== pin) throw new Error('Unconfirmed retirement');
  } catch {return fail('Local session cleared. CLI recovery retirement is pending on its original Vault; retry logout when it is reachable.');}
  mutateProfileAuthentication(profileName, current => {
    if (current.authGeneration !== generation || current.cliRecovery?.grantId !== saved.grantId ||
        current.cliRecovery.credential !== saved.credential || current.cliRecovery.state !== 'revocation_pending') {
      return fail('Profile changed during retirement. Retry the requested command.');
    }
    delete current.cliRecovery;return current;
  });
}

/** Explicit terminal initiator; shared Mobile MFA and the server own authentication. */
export async function recoverCliLogin(peer: QrLoginPeer, options: RecoverCliOptions): Promise<QrLoginResult> {
  const name = getActiveProfileName(), previous = getRuntimeProfile(), controller = new AbortController();
  const initialPin = peer.getTlsSpkiSha256?.();
  let snapshot: string | undefined, generation: string | undefined, stored = false, origin = '';
  let attempt: {requestId: string; claimant: string; expiresAt: number} | undefined;
  let deadline = Date.now() + 120_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {controller.abort('cancelled');};
  options.signal?.addEventListener('abort', cancel, {once: true});
  if (options.signal?.aborted) cancel();
  try {
    if (controller.signal.aborted) fail('CLI recovery cancelled.');
    const initial = getProfile(name);
    if (!initial?.cliRecovery || initial.apiKey || ['ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => process.env[key] !== undefined)) {
      return fail('CLI recovery requires a remembered human profile without API keys or environment credentials.');
    }
    const saved = checkedGrant(initial.cliRecovery, true);
    origin = saved.origin;
    if (cliLoginOrigin(initial.url) !== origin || cliLoginOrigin(peer.getBaseUrl()) !== origin) fail('CLI recovery profile or Vault changed.');
    snapshot = authenticationFingerprint(initial);setRuntimeProfile(name);
    const check = (current?: Profile): void => {
      if (controller.signal.aborted || Date.now() >= deadline || Date.now() >= saved.expiresAtSec * 1000) fail('CLI recovery expired or cancelled. Start a new explicit request.');
      invalidateProfileCache(name);
      if (getActiveProfileName() !== name || ['ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => process.env[key] !== undefined) ||
          authenticationFingerprint(current ?? getProfile(name)) !== snapshot || cliLoginOrigin(peer.getBaseUrl()) !== origin || peer.getTlsSpkiSha256?.() !== initialPin) {
        fail('CLI recovery profile or session changed. Start again.');
      }
    };
    const begun = beginProfileAuthentication(name, current => {check(current);}, true);
    generation = begun.authGeneration;snapshot = authenticationFingerprint(begun);
    const request = async (action: string, body?: unknown): Promise<unknown> => {
      check();
      const result = await peer.request<unknown>({method: action === 'protocol' ? 'GET' : 'POST',
        path: action === 'protocol' ? '/auth/mfa/iphone/protocol' : '/auth/cli/recovery/' + action,
        ...(body === undefined ? {} : {body}), skipAuth: true, skipAuthRefresh: true, signal: controller.signal,
        headers: {'User-Agent': 'znvault-cli/' + getVersion()}, sessionGuard: () => {check();}});
      check();return result;
    };
    timer = setTimeout(() => {controller.abort('expired');}, Math.max(0, deadline-Date.now()));
    const protocol = record(await request('protocol')), feature = record(protocol.cliRecovery);
    if (protocol.protocolVersion !== 3 || protocol.origin !== origin || protocol.installationId !== saved.installationId || feature.version !== 1 || feature.enabled !== true) {
      fail('CLI recovery is not enabled on this Vault.');
    }
    const codeVerifier = randomBytes(32).toString('base64url');
    const started = record(await request('start', {grantId: saved.grantId, credential: saved.credential,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url')}));
    if (typeof started.requestId !== 'string' || !uuid.test(started.requestId) || !capability(started.claimant) ||
        !Number.isSafeInteger(started.expiresAt) || Number(started.expiresAt)*1000 <= Date.now() || Number(started.expiresAt)*1000 > Date.now()+121_000 ||
        typeof started.comparisonNumber !== 'string' || !/^[1-9][0-9]$/.test(started.comparisonNumber)) fail('Invalid CLI recovery response. Start again.');
    attempt = {requestId: started.requestId, claimant: started.claimant, expiresAt: Number(started.expiresAt)};
    deadline = Math.min(deadline, attempt.expiresAt*1000, saved.expiresAtSec*1000);
    clearTimeout(timer);timer = setTimeout(() => {controller.abort('expired');}, Math.max(0, deadline-Date.now()));
    await options.onPending({comparisonNumber: started.comparisonNumber, expiresAtSec: attempt.expiresAt, origin});check();
    const proof = {requestId: attempt.requestId, claimant: attempt.claimant};
    for (;;) {
      const state = record(await request('status', proof));
      if (state.expiresAt !== attempt.expiresAt) fail('Invalid CLI recovery response. Start again.');
      if (state.state === 'approved') {
        const tokens = parseCliLoginResponse(await request('complete', {...proof, codeVerifier}));
        if (tokens.userSealedUnlocked || tokens.expiresIn > saved.expiresAtSec - Math.floor(Date.now()/1000) + 1 ||
            (initial.credentials?.userId && (tokens.user.id !== initial.credentials.userId || tokens.user.tenantId !== initial.credentials.tenantId))) {
          fail('Invalid CLI recovery response. Start again.');
        }
        check();
        mutateProfileAuthentication(name, current => {
          check(current);
          return {...current, credentials: {accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
            expiresAt: Math.min(Date.now()+tokens.expiresIn*1000, saved.expiresAtSec*1000), userId: tokens.user.id,
            username: tokens.user.username, role: tokens.user.role, tenantId: tokens.user.tenantId}};
        });
        stored = true;return {success: true, user: tokens.user};
      }
      if (!['pending', 'claimed'].includes(String(state.state))) fail('CLI recovery ended without approval. Start a new explicit request.');
      await delay(Math.min(2000, Math.max(0, deadline-Date.now())), undefined, {signal: controller.signal});
    }
  } catch (error) {
    const status = error !== null && typeof error === 'object' ? error as {statusCode?: number; retryAfterSeconds?: number} : {};
    if (status.statusCode !== undefined && [401, 403, 404, 410].includes(status.statusCode)) {
      return {success: false, error: 'iPhone recovery is unavailable, expired or revoked. Complete a normal login.'};
    }
    const retry = status.statusCode === 429 ? ` Too many requests. Retry after ${Math.max(1, Math.ceil(status.retryAfterSeconds ?? 30)).toString()} seconds.` : '';
    return {success: false, error: retry ? 'CLI recovery was rate limited.' + retry : controller.signal.aborted ? 'CLI recovery expired or cancelled.' :
      error instanceof RecoveryError ? error.message : 'CLI recovery did not finish. Run login --recover explicitly to try again; no session was stored.'};
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    if (attempt && !stored) {
      try {
        if (authenticationFingerprint(getProfile(name)) === snapshot && cliLoginOrigin(peer.getBaseUrl()) === origin && peer.getTlsSpkiSha256?.() === initialPin) {
          await peer.request({method: 'POST', path: '/auth/cli/recovery/cancel', body: {requestId: attempt.requestId, claimant: attempt.claimant},
            skipAuth: true, skipAuthRefresh: true, signal: AbortSignal.timeout(1000)});
        }
      } catch { /* Uncertain complete is never replayed; a new explicit recovery can replace it. */ }
    }
    try {if (!stored && generation !== undefined) cancelProfileAuthentication(name, generation);} catch { /* No tokens were installed. */ }
    setRuntimeProfile(previous);invalidateProfileCache(name);
  }
}
