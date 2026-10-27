import {setTimeout as delay} from 'node:timers/promises';
import {client, VaultClient, type RequestOptions} from './client.js';
import {getActiveProfileName, getProfile, invalidateProfileCache, setRuntimeProfile} from './config.js';
import {getRuntimeProfile} from './config/store.js';
import {getVersion} from './version.js';

export type ApprovalKind = 'unseal' | 'user-sealed';
export type UnsealScope = 'crypto' | 'root';
export interface ApprovalStatus {
  required: boolean;
  approved: boolean;
  method: string | null;
  expiresAt: string | null;
}
export interface ApprovalResult {
  unsealed?: boolean;
  unsealedUntil?: string | null;
  method?: string | null;
  scope?: string;
  unlocked?: boolean;
  approval?: ApprovalStatus;
}
export interface ApprovalSession {
  profileName: string;
  origin: string;
  account: string;
  check: (candidateAccessToken?: string) => void;
  request: <T>(method: RequestOptions['method'], path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
}

function fail(code: string): never {throw new Error(code);}

function identity(token: string): string {
  try {
    if (token.split('.').length !== 3) return fail('SESSION_APPROVAL_HUMAN_SESSION_REQUIRED');
    const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
    if (typeof value.sub !== 'string' || typeof value.refreshFamilyId !== 'string' || !value.refreshFamilyId
      || (value.tenantId !== undefined && value.tenantId !== null && typeof value.tenantId !== 'string') || typeof value.authEpoch !== 'number') {
      return fail('SESSION_APPROVAL_HUMAN_SESSION_REQUIRED');
    }
    // Local continuity check only. Signature, HUMAN identity and authority are verified by Vault.
    return JSON.stringify([value.sub, value.tenantId ?? null, value.refreshFamilyId, value.authEpoch]);
  } catch {return fail('SESSION_APPROVAL_HUMAN_SESSION_REQUIRED');}
}

function originOf(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return fail('SESSION_APPROVAL_PROFILE_HTTPS_REQUIRED');
  }
  return url.origin;
}

/** Pin only this invocation. A changed default never selects another profile's credentials. */
export async function withApprovalSession<T>(operation: (session: ApprovalSession) => Promise<T>): Promise<T> {
  const previous = getRuntimeProfile(), profileName = getActiveProfileName();
  const profile = getProfile(profileName);
  const ambientAuth = (): boolean => ['ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => !!process.env[key]);
  if (!profile?.credentials || profile.apiKey || ambientAuth()) return fail('SESSION_APPROVAL_HUMAN_SESSION_REQUIRED');
  const origin = originOf(profile.url), actor = identity(profile.credentials.accessToken);
  // Refuse an invocation override aimed at a different Vault; do not send profile credentials there.
  if (originOf(client.getBaseUrl()) !== origin) return fail('SESSION_APPROVAL_CONTEXT_CHANGED');
  setRuntimeProfile(profileName);
  invalidateProfileCache(profileName);
  try {
    const pin = client.getTlsSpkiSha256();
    const peer = new VaultClient({baseUrl: origin, insecure: false, timeout: profile.timeout,
      ...(pin ? {tlsSpkiSha256: pin} : {})});
    const check = (candidateAccessToken?: string): void => {
      const current = getProfile(profileName);
      try {
        if (getRuntimeProfile() !== profileName || ambientAuth() || current?.apiKey || !current?.credentials
          || originOf(current.url) !== origin || identity(current.credentials.accessToken) !== actor
          || (candidateAccessToken !== undefined && identity(candidateAccessToken) !== actor)) {
          fail('SESSION_APPROVAL_CONTEXT_CHANGED');
        }
      } catch {fail('SESSION_APPROVAL_CONTEXT_CHANGED');}
      invalidateProfileCache(profileName);
    };
    const session: ApprovalSession = {
      profileName, origin, account: `${profile.credentials.tenantId ?? 'system'}/${profile.credentials.username}`,
      check,
      request: async <R>(method: RequestOptions['method'], path: string, body?: unknown, signal?: AbortSignal): Promise<R> => {
        check();
        const target = new URL(path, origin);
        const result = await peer.request<R>({method, path: target.pathname, query: Object.fromEntries(target.searchParams), ...(body === undefined ? {} : {body}),
          headers: {'User-Agent': `znvault-cli/${getVersion()}`},
          ...(signal ? {signal} : {}), sessionGuard: check, skipAuthRefresh: true});
        check();
        return result;
      },
    };
    return await operation(session);
  } finally {setRuntimeProfile(previous); invalidateProfileCache(profileName);}
}

function approval(value: ApprovalStatus): ApprovalStatus {
  return {required: value.required, approved: value.approved, method: value.method, expiresAt: value.expiresAt};
}

export async function getApprovalStatus(session: ApprovalSession, kind: ApprovalKind, scope: UnsealScope = 'crypto'): Promise<ApprovalResult> {
  if (kind === 'user-sealed') {
    const value = await session.request<ApprovalResult>('GET', '/v1/user-sealed/status');
    return {unlocked: value.unlocked, ...(value.approval ? {approval: approval(value.approval)} : {})};
  }
  const value = await session.request<ApprovalResult>('GET', `/v1/auth/unseal/status?scope=${scope}`);
  return {unsealed: value.unsealed, unsealedUntil: value.unsealedUntil, method: value.method, scope: value.scope};
}

async function requirePrimaryKey(session: ApprovalSession, kind: ApprovalKind): Promise<void> {
  if (kind !== 'user-sealed') return;
  const status = await getApprovalStatus(session, kind);
  if (!status.unlocked) fail('SECRET_REQUIRES_USER_SESSION');
  if (!status.approval?.required) fail('SESSION_APPROVAL_PROTOCOL_DISABLED');
}

function installed(value: ApprovalResult, kind: ApprovalKind): boolean {
  const expiresAt = kind === 'user-sealed' ? value.approval?.expiresAt : value.unsealedUntil;
  return (kind === 'user-sealed' ? value.approval?.approved === true : value.unsealed === true)
    && typeof expiresAt === 'string' && Date.parse(expiresAt) > Date.now();
}

async function completeOnce(session: ApprovalSession, kind: ApprovalKind, path: string, body: unknown,
  scope: UnsealScope, signal?: AbortSignal): Promise<ApprovalResult> {
  try {
    await session.request<unknown>('POST', path, body, signal);
  } catch (error) {
    // An HTTP error is definitive. Only an ambiguous transport failure permits a status read.
    const value = error as {statusCode?: number; message?: string; name?: string};
    if (value.statusCode !== undefined || value.name === 'AbortError' || value.message?.startsWith('SESSION_APPROVAL_CONTEXT_CHANGED')) throw error;
    const status = await getApprovalStatus(session, kind, scope);
    if (installed(status, kind)) return status;
    fail('SESSION_APPROVAL_OUTCOME_UNKNOWN');
  }
  const status = await getApprovalStatus(session, kind, scope);
  if (!installed(status, kind)) fail('SESSION_APPROVAL_OUTCOME_UNKNOWN');
  return status;
}

export async function approveWithTOTP(session: ApprovalSession, kind: ApprovalKind,
  readCode: () => Promise<string>, scope: UnsealScope = 'crypto'): Promise<ApprovalResult> {
  await requirePrimaryKey(session, kind);
  const code = (await readCode()).trim();
  if (!/^\d{6}$/.test(code)) fail('SESSION_APPROVAL_INVALID_TOTP');
  return await completeOnce(session, kind, kind === 'user-sealed' ? '/v1/user-sealed/approval/totp' : '/v1/auth/unseal',
    {totpCode: code, ...(kind === 'unseal' ? {scope} : {})}, scope);
}

export interface IPhoneApprovalOptions {
  deviceId?: string;
  scope?: UnsealScope;
  signal?: AbortSignal;
  onPending?: (value: {account: string; origin: string; comparisonNumber: string; expiresAt: number}) => void;
}

export async function approveWithIPhone(session: ApprovalSession, kind: ApprovalKind, options: IPhoneApprovalOptions): Promise<ApprovalResult> {
  await requirePrimaryKey(session, kind);
  const {devices} = await session.request<{devices: Array<{id: string; ready: boolean; state: string}>}>('GET', '/auth/mfa/iphone/devices', undefined, options.signal);
  const ready = devices.filter(device => device.ready && device.state === 'active');
  const device = options.deviceId ? ready.find(item => item.id === options.deviceId) : ready.length === 1 ? ready[0] : undefined;
  if (!device) fail(ready.length > 1 ? 'SESSION_APPROVAL_SELECT_IPHONE: use --iphone-device <id>' : 'SESSION_APPROVAL_IPHONE_NOT_READY');
  const base = kind === 'unseal' ? '/v1/auth/unseal/iphone' : '/v1/user-sealed/approval/iphone';
  const scope = options.scope ?? 'crypto';
  const pending = await session.request<{requestId: string; claimant: string; comparisonNumber: string; expiresAt: number}>(
    'POST', `${base}/start`, {deviceId: device.id, ...(kind === 'unseal' ? {scope} : {})}, options.signal);
  const body = {requestId: pending.requestId, claimant: pending.claimant}; // Memory only, never returned to output.
  let completed = false;
  try {
    if (!/^\d{2}$/.test(pending.comparisonNumber) || !Number.isFinite(pending.expiresAt)) fail('SESSION_APPROVAL_INVALID_CHALLENGE');
    options.onPending?.({account: session.account, origin: session.origin, comparisonNumber: pending.comparisonNumber, expiresAt: pending.expiresAt});
    while (Date.now() < pending.expiresAt * 1000) {
      options.signal?.throwIfAborted();
      const value = await session.request<{state: string}>('POST', `${base}/status`, body, options.signal);
      if (value.state === 'approved') {
        const result = await completeOnce(session, kind, `${base}/complete`, body, scope, options.signal);
        completed = true;
        return result;
      }
      if (value.state !== 'pending') fail(`SESSION_APPROVAL_${value.state === 'denied' ? 'DENIED' : 'EXPIRED'}`);
      await delay(2000, undefined, {signal: options.signal});
    }
    return fail('SESSION_APPROVAL_EXPIRED');
  } finally {
    if (!completed) {
      try {await session.request('POST', `${base}/cancel`, body);} catch { /* Same-context best effort only; otherwise expires server-side. */ }
    }
  }
}

export async function closeUserSealedAccess(session: ApprovalSession): Promise<ApprovalResult> {
  await session.request('POST', '/v1/user-sealed/approval/close', {});
  return await getApprovalStatus(session, 'user-sealed');
}
