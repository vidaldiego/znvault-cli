// Path: src/lib/client/http.ts

/**
 * Base HTTP client functionality
 * Handles request making, authentication, and token refresh
 */

import https from 'node:https';
import http from 'node:http';
import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import {
  getConfig,
  getCredentials,
  getApiKey,
  hasApiKey,
  storeCredentials,
  isTokenExpired,
  getEnvCredentials,
  hasEnvCredentials,
  writePendingRefreshMarker,
  decidePendingRefresh,
  decodeRefreshJti,
  logPendingRefreshRecovery,
  getActiveProfileName,
  invalidateProfileCache,
  authenticationFingerprint,
  beginProfileAuthentication,
  cancelProfileAuthentication,
  type Profile,
} from '../config.js';
import type {QrLoginPeer, QrLoginResult} from '../qr-login.js';
import { acquireRefreshLock, computeLockKey } from './refresh-lock.js';
import * as output from '../output.js';
import type { RequestOptions, ClientConfig } from './types.js';
import type { LoginResponse, StoredCredentials, FullConfig } from '../../types/index.js';

/** Invocation-wide policy shared by facade and domain clients; no HTTP/singleton cycle. */
let automaticRecovery: {present: (peer: QrLoginPeer, signal: AbortSignal) => Promise<QrLoginResult>} | null = null;
export function configureAutomaticRecovery(policy: typeof automaticRecovery): void {automaticRecovery = policy;}

/** Track if insecure warning has been shown (show only once per session) */
let insecureWarningShown = false;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function verifyPinnedServerSpki(
  certificateRaw: Buffer | undefined,
  expectedSha256: string,
): Error | undefined {
  if (!SHA256_HEX.test(expectedSha256)) {
    return new Error('Invalid TLS SPKI SHA-256 pin');
  }
  if (!certificateRaw || certificateRaw.byteLength < 1) {
    return new Error('TLS peer certificate is unavailable for SPKI verification');
  }
  try {
    const certificate = new X509Certificate(certificateRaw);
    const spki = certificate.publicKey.export({ type: 'spki', format: 'der' });
    const observed = createHash('sha256').update(spki).digest();
    const expected = Buffer.from(expectedSha256, 'hex');
    if (observed.byteLength !== expected.byteLength || !timingSafeEqual(observed, expected)) {
      return new Error('TLS server SPKI SHA-256 does not match the reviewed pin');
    }
    return undefined;
  } catch {
    return new Error('TLS peer certificate could not be verified against the SPKI pin');
  }
}

/**
 * Terminal: a second consecutive 409 / orphaned past-TTL marker — caller must
 * `znvault login`; no token is re-presented (design §A.1, finding C1).
 */
export class RefreshHardReauthError extends Error {
  readonly statusCode: number;
  constructor(readonly orphanedMarker = false) {
    super(getConfig().cliRecovery?.state === 'active'
      ? 'Session refresh cannot continue. Run znvault login --recover; or complete a normal login.'
      : 'Refresh in progress on another process or recovery needed; please run: znvault login');
    this.name = 'RefreshHardReauthError';this.statusCode = orphanedMarker ? 401 : 409;
  }
}

/** Only structured HTTP status classifies refresh contention. */
function isConflict(err: unknown): boolean {
  return (err as {statusCode?: number} | null)?.statusCode === 409;
}

/**
 * Type guard to check if a value looks like an API error response
 */
function isApiErrorLike(
  value: unknown,
): value is { message?: string; error?: string; code?: unknown; steps?: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('message' in value || 'error' in value)
  );
}

/**
 * Validate that a parsed response is a valid object (not null/undefined).
 * This provides basic protection against malformed API responses.
 */
function validateResponseShape(parsed: unknown, statusCode: number): void {
  // For 204 No Content, empty response is valid
  if (statusCode === 204) return;

  // Null or undefined responses are unexpected for success codes
  if (parsed === null || parsed === undefined) {
    throw new Error(`Unexpected empty response from API (status ${statusCode})`);
  }
}

/**
 * Base HTTP client class with authentication support
 */
export class HttpClient {
  // Explicit per-invocation overrides (from --url / --insecure / explicit
  // construction config). When set, they win over profile resolution.
  //
  // F1 fix: do NOT freeze the profile's baseUrl/insecure at construction time.
  // The client singleton is built at module-import, before the `--profile`
  // preAction hook applies the runtime override; freezing here routed
  // `--profile X <cmd>` to the ACTIVE profile's URL instead of profile X's.
  // Instead, resolve from getConfig() per-request (it honors the runtime
  // override) and only let explicit --url/--insecure take precedence.
  private urlOverride?: string;
  private insecureOverride?: boolean;
  private tlsSpkiSha256Override?: string;
  protected timeout: number;
  private refreshPromise: Promise<void> | null = null;

  constructor(config?: Partial<ClientConfig>) {
    const defaultConfig = getConfig();
    if (config?.baseUrl !== undefined) this.urlOverride = config.baseUrl;
    if (config?.insecure !== undefined) this.insecureOverride = config.insecure;
    if (config?.tlsSpkiSha256 !== undefined) {
      if (!SHA256_HEX.test(config.tlsSpkiSha256)) {
        throw new Error('Invalid TLS SPKI SHA-256 pin');
      }
      this.tlsSpkiSha256Override = config.tlsSpkiSha256;
      this.insecureOverride = false;
    }
    this.timeout = config?.timeout ?? defaultConfig.timeout;

    // Warn about insecure mode (once per session)
    if (this.resolveInsecure() && !insecureWarningShown) {
      insecureWarningShown = true;
      output.warn('TLS certificate verification is disabled (--insecure or ZNVAULT_INSECURE=true)');
      output.warn('This is insecure and should only be used for development/testing');
    }
  }

  /**
   * Resolve the effective base URL at call time: explicit --url override wins,
   * otherwise the currently-resolved profile's URL (which follows --profile,
   * ZNVAULT_PROFILE, and ZNVAULT_URL via getConfig()).
   */
  protected resolveBaseUrl(): string {
    return this.urlOverride ?? getConfig().url;
  }

  /** Resolve the effective insecure flag at call time (explicit override wins). */
  protected resolveInsecure(): boolean {
    return this.insecureOverride ?? getConfig().insecure;
  }

  /**
   * Return only invocation-scoped transport overrides, so facade clients can
   * pass them to lazily-created domain clients without freezing profile
   * configuration. Profile values still resolve independently per request.
   */
  protected getExplicitClientConfig(): Partial<ClientConfig> {
    return {
      ...(this.urlOverride !== undefined ? { baseUrl: this.urlOverride } : {}),
      ...(this.insecureOverride !== undefined ? { insecure: this.insecureOverride } : {}),
      ...(this.tlsSpkiSha256Override !== undefined
        ? { tlsSpkiSha256: this.tlsSpkiSha256Override }
        : {}),
      timeout: this.timeout,
    };
  }

  /**
   * Backwards-compatible accessor. Some call sites read `this.baseUrl`; keep it
   * as a live getter so it always reflects the resolved profile.
   */
  protected get baseUrl(): string {
    return this.resolveBaseUrl();
  }

  /** Backwards-compatible accessor for the resolved insecure flag. */
  protected get insecure(): boolean {
    return this.resolveInsecure();
  }

  /**
   * Update client configuration (explicit --url / --insecure overrides).
   */
  configure(url?: string, insecure?: boolean, tlsSpkiSha256?: string): void {
    if (insecure === true && tlsSpkiSha256 !== undefined) {
      throw new Error('TLS SPKI pinning requires certificate verification');
    }
    if (url) this.urlOverride = url;
    if (insecure !== undefined) this.insecureOverride = insecure;
    if (tlsSpkiSha256 !== undefined) {
      if (!SHA256_HEX.test(tlsSpkiSha256)) {
        throw new Error('Invalid TLS SPKI SHA-256 pin');
      }
      this.tlsSpkiSha256Override = tlsSpkiSha256;
      this.insecureOverride = false;
    }
  }

  /**
   * Get base URL (resolved at call time).
   */
  getBaseUrl(): string {
    return this.resolveBaseUrl();
  }

  getInsecure(): boolean {return this.resolveInsecure();}

  /** Return the invocation-scoped TLS public-key pin, when one is active. */
  getTlsSpkiSha256(): string | null {
    return this.tlsSpkiSha256Override ?? null;
  }

  /** Refresh may change tokens, but never cross a profile/authentication generation. */
  private authenticationGuard(outer?: RequestOptions['sessionGuard'], configuration: FullConfig = getConfig()): NonNullable<RequestOptions['sessionGuard']> {
    const name = getActiveProfileName(), fingerprint = authenticationFingerprint(configuration, false);
    const origin = this.getBaseUrl(), pin = this.getTlsSpkiSha256(), apiKey = getApiKey();
    const insecure = this.resolveInsecure();
    return candidate => {
      outer?.(candidate);invalidateProfileCache(name);
      if (getActiveProfileName() !== name || authenticationFingerprint(getConfig(), false) !== fingerprint ||
          this.getBaseUrl() !== origin || this.getTlsSpkiSha256() !== pin || this.resolveInsecure() !== insecure || getApiKey() !== apiKey) {
        throw new Error('CLI profile or authentication generation changed. Explicitly retry the operation.');
      }
    };
  }

  /**
   * Ensure token is valid, refreshing if needed with mutex to prevent race conditions.
   * The synchronization ensures that only one refresh happens even if multiple
   * concurrent requests detect an expired token simultaneously.
   */
  private async ensureValidToken(sessionGuard?: RequestOptions['sessionGuard']): Promise<void> {
    sessionGuard?.();
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      await this.refreshPromise;
      sessionGuard?.();
      return;
    }

    // Check token validity - if not expired, we're done
    if (!isTokenExpired()) return;

    // §A.1 gate: never start a proactive refresh on an already-marked token.
    // The marked token must NEVER be presented; trigger a non-revoking hard
    // re-auth instead and emit the recovery observability event (A3).
    const decision = decidePendingRefresh();
    if (decision.action !== 'none') {
      logPendingRefreshRecovery(decision.action === 'clean-relogin' ? decision.reason : 'marker_in_flight');
      throw new RefreshHardReauthError(true);
    }

    // Double-check pattern: after confirming expiry, a CONCURRENT caller may have
    // started a refresh while we were checking. TypeScript "proves" this.refreshPromise
    // is null here (the earlier guard returned when it was set) — but that proof assumes
    // single-threaded flow; the field can be reassigned between the two checks, which is
    // the whole point of this second guard. Re-read it through an assertion so the
    // control-flow narrowing doesn't apply.
    const inFlight = this.refreshPromise as Promise<void> | null;
    if (inFlight !== null) {
      await inFlight;
      sessionGuard?.();
      return;
    }

    // We're the first to detect expiry - start the refresh
    this.refreshPromise = this.refreshToken(sessionGuard ? {sessionGuard} : undefined).finally(() => {
      this.refreshPromise = null;
    });

    await this.refreshPromise;
  }

  /**
   * Refresh the access token.
   *
   * Wraps the refresh in a cross-PROCESS lock (on top of the in-process
   * `refreshPromise` mutex), re-reads credentials after acquire (so a peer that
   * already rotated short-circuits the network), performs the TOCTOU
   * release-and-reacquire when the re-read token rekeys the lock (A1), writes the
   * §A.1 write-ahead marker with the REAL jti before POSTing, clears it
   * atomically with the new tokens on success, retries once on a 409 with a
   * DIFFERENT token, and keeps the marker on an ambiguous failure.
   */
  async refreshToken(opts?: { skipIfLive?: boolean; sessionGuard?: RequestOptions['sessionGuard'] }): Promise<void> {
    const guard = this.authenticationGuard(opts?.sessionGuard);
    guard();
    // `skipIfLive` (default true) lets the proactive path no-op when the token
    // is already live (a peer rotated in the window since `ensureValidToken`
    // checked). The 401-replay path passes `false`: there the token is often
    // still clock-VALID but server-REJECTED (JTI gone after a restart, the
    // v3.3.0 fix), so it MUST force a real refresh and never short-circuit.
    const skipIfLive = opts?.skipIfLive ?? true;
    const credentials = getCredentials();
    if (!credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }
    // Gate: a marked token must NEVER be presented (design §A.1).
    const decision = decidePendingRefresh();
    if (decision.action !== 'none') {
      logPendingRefreshRecovery(decision.action === 'clean-relogin' ? decision.reason : 'marker_in_flight');     // A3 observability
      throw new RefreshHardReauthError(true);
    }

    // Entry-level fast path: if the token is already live (e.g. a peer rotated
    // before we even reached here), there is nothing to refresh — skip the lock
    // and the network entirely. Disabled for the 401-replay (see above).
    if (skipIfLive && !isTokenExpired()) {
      return;
    }

    const profile = getActiveProfileName();
    let lockKey = computeLockKey(credentials.refreshToken, profile);
    let lock = await acquireRefreshLock(lockKey); // null on 5s timeout -> best-effort

    try {
      guard();
      // The 5s profile cache from the pre-acquire getCredentials() can mask a peer's
      // rotation that happened DURING the lock wait. Invalidate so the re-reads below
      // hit disk — that's the whole point of re-reading after acquiring the lock.
      invalidateProfileCache(profile);
      // Re-read after acquire: a peer may have rotated while we waited.
      let fresh = getCredentials();
      if (skipIfLive && fresh && !isTokenExpired()) {
        return; // peer rotated to a live token -> nothing to do (skip network)
      }
      // TOCTOU reacquire (A1, closes finding C): if the re-read token's HMAC
      // differs from the key we acquired, we hold the WRONG lock. Release and
      // reacquire ONCE under the new key before proceeding.
      if (lock && fresh?.refreshToken) {
        const reKey = computeLockKey(fresh.refreshToken, profile);
        if (reKey !== lock.lockKey) {
          await lock.release();
          lockKey = reKey;
          lock = await acquireRefreshLock(lockKey);
          guard();
          // Same staleness applies after the reacquire wait — invalidate again so
          // this re-read hits disk and can observe a peer's rotation.
          invalidateProfileCache(profile);
          fresh = getCredentials();
          if (skipIfLive && fresh && !isTokenExpired()) {
            return; // peer finished while we re-acquired
          }
        }
      }

      if (fresh?.pendingRefresh) throw new RefreshHardReauthError(true);
      await this.postRefreshWithRetry(fresh ?? credentials, 0, guard);
    } catch (error) {
      guard();
      if (getConfig().cliRecovery?.state === 'active' && !(error instanceof RefreshHardReauthError)) {
        throw Object.assign(new Error('Session refresh failed. Run znvault login --recover or complete a normal login.', {cause: error}),
          error !== null && typeof error === 'object' ? error : {});
      }
      throw error;
    } finally {
      await lock?.release();
    }
  }

  /** One POST; on 409 a single retry with a DIFFERENT token; second 409 is terminal. */
  private async postRefreshWithRetry(credentials: StoredCredentials, attempt: number, guard?: RequestOptions['sessionGuard']): Promise<void> {
    guard?.();
    // Marker stores the REAL jti claim (C2), not a token slice.
    const presentedJti = decodeRefreshJti(credentials.refreshToken) ?? credentials.refreshToken.slice(0, 16);
    if (guard) writePendingRefreshMarker(presentedJti, guard);
    else writePendingRefreshMarker(presentedJti); // write-ahead intent before POST
    let response: LoginResponse;
    try {
      response = await this.request<LoginResponse>({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken: credentials.refreshToken },
        skipAuth: true,
        _refreshAccessToken: credentials.accessToken,
        ...(guard ? {sessionGuard: guard} : {}),
      });
    } catch (err) {
      if (isConflict(err)) {
        guard?.();
        // 409 refresh_in_progress: at most ONE retry, only with a DIFFERENT token.
        if (attempt >= 1) throw Object.assign(new RefreshHardReauthError(), err);
        const reread = getCredentials();
        if (!reread?.refreshToken || reread.refreshToken === credentials.refreshToken || reread.pendingRefresh) {
          // No different token available -> terminal, never re-present the same JTI.
          throw Object.assign(new RefreshHardReauthError(), err);
        }
        await this.postRefreshWithRetry(reread, attempt + 1, guard);
        return;
      }
      // Ambiguous (network/5xx): KEEP the marker, do not clear, do not assume "not rotated".
      throw err;
    }
    // Success: write new tokens AND clear the marker in the SAME write.
    // (Spreading ...credentials carries a pre-existing marker forward, so we must
    //  explicitly set pendingRefresh: undefined to clear it — omission alone does NOT
    //  strip a spread key. decidePendingRefresh treats undefined as "no marker".)
    const nextCredentials: StoredCredentials = {
      ...credentials,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      pendingRefresh: undefined, // explicit clear (overrides the spread)
    };
    if (guard) storeCredentials(nextCredentials, () => {guard(response.accessToken);});
    else storeCredentials(nextCredentials);
  }

  /**
   * Login with username and password
   */
  async login(username: string, password: string, totp?: string, beforeStart?: (current: Profile) => void): Promise<LoginResponse> {
    const configuration = getConfig(), name = getActiveProfileName(), begun = beginProfileAuthentication(name, beforeStart);
    const guard = this.authenticationGuard(undefined, {...configuration, authGeneration: begun.authGeneration, cliRecovery: begun.cliRecovery});
    let stored = false;
    try {
      const response = await this.request<LoginResponse>({
      method: 'POST',
      path: '/auth/login',
      body: { username, password, totpCode: totp },
      skipAuth: true,
      skipAuthRefresh: true,
      sessionGuard: guard,
    });

    storeCredentials({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      userId: response.user.id,
      username: response.user.username,
      role: response.user.role,
      tenantId: response.user.tenantId,
    }, () => {guard();});
    stored = true;return response;
    } finally {if (!stored) cancelProfileAuthentication(name, begun.authGeneration);}
  }

  /**
   * Make an HTTP request
   */
  async request<T>(options: RequestOptions): Promise<T> {
    options.signal?.throwIfAborted();options.sessionGuard?.();
    const recovery = {attempted: false};
    let replayed = false;
    const eligible = (): boolean => automaticRecovery !== null && !recovery.attempted && !options.skipAuth && !options.skipAuthRefresh &&
      !options.sessionGuard && !hasApiKey() &&
      !['ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD'].some(key => process.env[key] !== undefined) &&
      process.env.ZNVAULT_LOCAL !== '1' && getConfig().cliRecovery?.state === 'active' &&
      !/^\/(?:v1\/)?(?:auth(?:\/|$)|user-sealed\/approval(?:\/|$)|devices(?:\/|$))/.test(options.path);
    let guard = eligible() ? this.authenticationGuard(options.sessionGuard) : options.sessionGuard;
    const recover = async (): Promise<void> => {
      guard?.();options.signal?.throwIfAborted();
      recovery.attempted = true;
      const origin = this.getBaseUrl(), pin = this.getTlsSpkiSha256(), insecure = this.resolveInsecure();
      const policy = automaticRecovery;
      if (policy === null) throw new Error('Automatic CLI recovery is disabled.');
      const {coordinateCliRecovery} = await import('../cli-recovery.js');
      guard?.();options.signal?.throwIfAborted();
      const receipt = await coordinateCliRecovery(this, policy.present, options.signal);
      options.signal?.throwIfAborted();
      if (getConfig().authGeneration !== receipt.authGeneration || getConfig().cliRecovery?.grantId !== receipt.grantId ||
          this.getBaseUrl() !== origin || this.getTlsSpkiSha256() !== pin || this.resolveInsecure() !== insecure) {
        throw new Error('CLI recovery transport changed. Explicitly retry.');
      }
      guard = this.authenticationGuard(options.sessionGuard);guard();
    };
    const status = (error: unknown): number | undefined => (error as {statusCode?: number} | null)?.statusCode;
    const safe = options.method === 'GET' || options.recoveryReplaySafe === true;
    const send = (): Promise<T> => this.prepareRequest<T>({...options, sessionGuard: guard});
    if (!getCredentials() && eligible()) await recover();
    // Refresh completes (and releases its lock) before recovery can ask the phone.
    if (!options.skipAuth && !recovery.attempted && getCredentials()?.refreshToken && isTokenExpired()) {
      try {await this.ensureValidToken(guard);}
      catch (error) {if (status(error) === 401 && eligible()) await recover();else throw error;}
    }
    try {return await send();}
    catch (error) {
      if (status(error) !== 401 || options.skipAuth || options.skipAuthRefresh || options.sessionGuard ||
          /^\/(?:v1\/)?(?:auth(?:\/|$)|user-sealed\/approval(?:\/|$))/.test(options.path)) throw error;
      if (recovery.attempted) throw error;
      let terminal: unknown = error;
      let refreshed = false;
      if (getCredentials()?.refreshToken) {
        try {
          await this.refreshToken({skipIfLive: false, sessionGuard: guard});
          refreshed = true;
          if (safe) {
            replayed = true;
            try {return await send();} catch (retryError) {if (status(retryError) !== 401) throw retryError;terminal = retryError;}
          } else {
            throw Object.assign(new Error('Session refreshed; operation was not reissued. Explicitly repeat the operation.'), {statusCode: 401});
          }
        } catch (refreshError) {
          if (status(refreshError) !== 401) throw refreshError;
          terminal = refreshError;
        }
      }
      if (refreshed && !safe) throw terminal;
      if (!eligible()) throw terminal;
      await recover();
      if (!safe || replayed) throw Object.assign(new Error('Session recovered; operation was not reissued. Explicitly repeat the operation.'), {statusCode: 401});
      return await send();
    }
  }

  private async prepareRequest<T>(options: RequestOptions): Promise<T> {
    options.sessionGuard?.();
    const url = new URL(this.baseUrl);
    url.pathname = options.path;

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    // Add authentication
    if (!options.skipAuth) {
      const apiKey = getApiKey();
      if (hasApiKey() && apiKey) {
        headers['X-API-Key'] = apiKey;
      } else {
        const credentials = getCredentials();
        if (credentials) {
          const updatedCredentials = getCredentials();
          if (updatedCredentials) {
            headers.Authorization = `Bearer ${updatedCredentials.accessToken}`;
          }
        } else if (hasEnvCredentials()) {
          const envCreds = getEnvCredentials();
          if (envCreds) {
            await this.login(envCreds.username, envCreds.password);
            const newCredentials = getCredentials();
            if (newCredentials) {
              headers.Authorization = `Bearer ${newCredentials.accessToken}`;
            }
          }
        }
      }
    }

    // Refresh remains unauthenticated for ordinary token rotation, but the
    // current access token is supplied as an optional same-family proof. The
    // server validates its signature, family, provenance, revocation and unlock
    // deadlines. Access-token expiry alone does not discard a continuity proof.
    if (options.skipAuth && options._refreshAccessToken) {
      headers.Authorization = `Bearer ${options._refreshAccessToken}`;
    }

    if (options.headers) {
      const protectedHeaders = new Set([
        'authorization',
        'x-api-key',
        'host',
        'content-length',
        'content-type',
      ]);
      for (const [name, value] of Object.entries(options.headers)) {
        if (protectedHeaders.has(name.toLowerCase())) {
          throw new Error(`Refusing to override protected HTTP header '${name}'`);
        }
        if (name.includes('\r') || name.includes('\n') || value.includes('\r') || value.includes('\n')) {
          throw new Error('Refusing an HTTP header containing a newline');
        }
        headers[name] = value;
      }
    }

    return this.sendRequest<T>(url, headers, options);
  }

  /** Send with the prepared origin and authentication, including one safe replay. */
  private sendRequest<T>(url: URL, headers: Record<string, string>, options: RequestOptions): Promise<T> {
    options.sessionGuard?.();
    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers,
      timeout: this.timeout,
      rejectUnauthorized: !this.insecure,
      ...(options.signal ? {signal: options.signal} : {}),
    };

    if (this.tlsSpkiSha256Override !== undefined) {
      if (url.protocol !== 'https:') {
        throw new Error('TLS SPKI pinning requires an https URL');
      }
      const expectedSha256 = this.tlsSpkiSha256Override;
      requestOptions.checkServerIdentity = (hostname: string, certificate: PeerCertificate) => {
        const identityError = checkServerIdentity(hostname, certificate);
        if (identityError) return identityError;
        return verifyPinnedServerSpki(certificate.raw, expectedSha256);
      };
    }

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => (data += String(chunk)));
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          const header = (res.headers as http.IncomingHttpHeaders | undefined)?.['retry-after'];
          const wait = typeof header === 'string' ? (/^[0-9]+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header)-Date.now())/1000)) : NaN;
          const retryAfterSeconds = Number.isSafeInteger(wait) && wait >= 0 ? Math.max(1, wait) : undefined;
          if (statusCode >= 300 && statusCode < 400) {
            // Only the server's tenant-isolation migration is replayable. Keep
            // the exact suffix/query, origin, method, payload and prepared auth.
            if (statusCode === 307 && !options._followedTenantRedirect &&
                /^\/v1\/tenants(?:\/|$)/.test(url.pathname) && res.headers.location) {
              try {
                const target = new URL(res.headers.location, url);
                const expected = new URL(url);
                expected.pathname = `/v1/superadmin${url.pathname.slice('/v1'.length)}`;
                if (target.href === expected.href) {
                  this.sendRequest<T>(target, headers, {
                    ...options,
                    path: target.pathname,
                    _followedTenantRedirect: true,
                  }).then(resolve, reject);
                  return;
                }
              } catch {
                // Malformed locations fail closed below, without exposing them.
              }
            }
            reject(Object.assign(new Error(
              `Refusing HTTP ${statusCode.toString()} redirect: only one exact same-origin tenant-management redirect is allowed`,
            ), {statusCode}));
            return;
          }
          try {
            // Parse response - empty string becomes empty object for successful responses
            const parsed: unknown = data ? JSON.parse(data) : (statusCode === 204 ? undefined : {});

            if (statusCode >= 400) {
              if (isApiErrorLike(parsed)) {
                const errorMessage = parsed.message ?? parsed.error ?? `Request failed with status ${statusCode}`;
                const symbolicCode = typeof parsed.code === 'string' && parsed.code.length > 0
                  ? parsed.code
                  : undefined;
                const renderedMessage = symbolicCode !== undefined && !errorMessage.includes(symbolicCode)
                  ? `${symbolicCode}: ${errorMessage}`
                  : errorMessage;
                const advice = symbolicCode === 'USER_SEALED_APPROVAL_REQUIRED'
                  ? ' Run znvault user-sealed approve --iphone or --otp, then explicitly repeat the operation.' : '';
                const e = new Error(renderedMessage + advice);
                // Preserve the machine-readable parts of the error body so
                // callers (e.g. dynamic-secrets provision/routines commands)
                // can render a partial-progress report instead of just a
                // message + status code. `errorCode`/`steps` are only set
                // when present in the body; `details` carries the full
                // parsed body for forward-compat with future fields.
                const ext = e as Error & {
                  statusCode?: number;
                  errorCode?: string;
                  steps?: unknown[];
                  details?: unknown;
                  retryAfterSeconds?: number;
                };
                ext.statusCode = statusCode;
                if (retryAfterSeconds !== undefined) ext.retryAfterSeconds = retryAfterSeconds;
                if (symbolicCode !== undefined) ext.errorCode = symbolicCode;
                else if (parsed.error !== undefined) ext.errorCode = parsed.error;
                if (parsed.steps !== undefined) ext.steps = parsed.steps;
                ext.details = parsed;
                reject(e);
              } else {
                const e = new Error(`HTTP ${statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`);
                Object.assign(e, {statusCode, ...(retryAfterSeconds !== undefined ? {retryAfterSeconds} : {})});
                reject(e);
              }
            } else {
              // Validate response shape before returning
              validateResponseShape(parsed, statusCode);
              resolve(parsed as T);
            }
          } catch (parseError) {
            if (statusCode >= 400) {
              reject(Object.assign(new Error(`Request failed with status ${statusCode}`), {statusCode, ...(retryAfterSeconds !== undefined ? {retryAfterSeconds} : {})}));
            } else if (parseError instanceof Error && parseError.message.includes('Unexpected')) {
              // Re-throw validation errors
              reject(parseError);
            } else {
              // Non-JSON response for success - pass through raw data
              resolve(data as unknown as T);
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body !== undefined && options.body !== null) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  /**
   * Get authentication headers for WebSocket connection
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    const apiKey = getApiKey();
    if (hasApiKey() && apiKey) {
      headers['X-API-Key'] = apiKey;
    } else {
      const credentials = getCredentials();
      if (credentials) {
        if (isTokenExpired() && credentials.refreshToken) {
          await this.ensureValidToken();
        }
        const updatedCredentials = getCredentials();
        if (updatedCredentials) {
          headers.Authorization = `Bearer ${updatedCredentials.accessToken}`;
        }
      } else if (hasEnvCredentials()) {
        const envCreds = getEnvCredentials();
        if (envCreds) {
          await this.login(envCreds.username, envCreds.password);
          const newCredentials = getCredentials();
          if (newCredentials) {
            headers.Authorization = `Bearer ${newCredentials.accessToken}`;
          }
        }
      }
    }

    return headers;
  }

  /**
   * Get WebSocket URL for a given endpoint path
   */
  getWebSocketUrl(wsPath: string): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = wsPath;
    return url.toString();
  }

  // Generic request methods for arbitrary endpoints

  async get<T>(path: string): Promise<T> {
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({
      method: 'GET',
      path: basePath,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({
      method: 'POST',
      path: basePath,
      body,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({
      method: 'PUT',
      path: basePath,
      body,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({
      method: 'PATCH',
      path: basePath,
      body,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    const [basePath, queryString] = path.split('?');
    const query: Record<string, string> = {};
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        query[key] = value;
      }
    }
    return this.request<T>({
      method: 'DELETE',
      path: basePath,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }
}
