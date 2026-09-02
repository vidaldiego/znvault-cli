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
} from '../config.js';
import { acquireRefreshLock, computeLockKey } from './refresh-lock.js';
import * as output from '../output.js';
import type { RequestOptions, ClientConfig } from './types.js';
import type { LoginResponse, StoredCredentials } from '../../types/index.js';

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
  constructor() {
    super('Refresh in progress on another process or recovery needed; please run: znvault login');
    this.name = 'RefreshHardReauthError';
  }
}

/**
 * C1: the server returns 409 `refresh_in_progress` on a within-window same-family
 * race, but `request()` attaches `.statusCode` to the thrown Error and DISCARDS
 * the body — so detect via `statusCode === 409` (with a message-text fallback).
 * NB: there is no `.body` on the thrown error; a `.body.error` check would be DEAD.
 */
function isConflict(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string } | undefined;
  return e?.statusCode === 409 || (typeof e?.message === 'string' && e.message.includes('refresh_in_progress'));
}

/**
 * Type guard to check if a value looks like an API error response
 */
function isApiErrorLike(
  value: unknown,
): value is { message?: string; error?: string; steps?: unknown[] } {
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

  /**
   * Ensure token is valid, refreshing if needed with mutex to prevent race conditions.
   * The synchronization ensures that only one refresh happens even if multiple
   * concurrent requests detect an expired token simultaneously.
   */
  private async ensureValidToken(): Promise<void> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    // Check token validity - if not expired, we're done
    if (!isTokenExpired()) return;

    // §A.1 gate: never start a proactive refresh on a past-TTL marked token.
    // The marked token must NEVER be presented; trigger a non-revoking hard
    // re-auth instead and emit the recovery observability event (A3).
    const decision = decidePendingRefresh();
    if (decision.action === 'clean-relogin') {
      logPendingRefreshRecovery(decision.reason);
      throw new RefreshHardReauthError();
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
      return;
    }

    // We're the first to detect expiry - start the refresh
    this.refreshPromise = this.refreshToken().finally(() => {
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
  async refreshToken(opts?: { skipIfLive?: boolean }): Promise<void> {
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
    // Gate: a marked token past TTL must NEVER be presented (design §A.1).
    const decision = decidePendingRefresh();
    if (decision.action === 'clean-relogin') {
      logPendingRefreshRecovery(decision.reason);     // A3 observability
      throw new RefreshHardReauthError();
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
          // Same staleness applies after the reacquire wait — invalidate again so
          // this re-read hits disk and can observe a peer's rotation.
          invalidateProfileCache(profile);
          fresh = getCredentials();
          if (skipIfLive && fresh && !isTokenExpired()) {
            return; // peer finished while we re-acquired
          }
        }
      }

      await this.postRefreshWithRetry(fresh ?? credentials, 0);
    } finally {
      await lock?.release();
    }
  }

  /** One POST; on 409 a single retry with a DIFFERENT token; second 409 is terminal. */
  private async postRefreshWithRetry(credentials: StoredCredentials, attempt: number): Promise<void> {
    // Marker stores the REAL jti claim (C2), not a token slice.
    const presentedJti = decodeRefreshJti(credentials.refreshToken) ?? credentials.refreshToken.slice(0, 16);
    writePendingRefreshMarker(presentedJti); // write-ahead intent before POST
    let response: LoginResponse;
    try {
      response = await this.request<LoginResponse>({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken: credentials.refreshToken },
        skipAuth: true,
      });
    } catch (err) {
      if (isConflict(err)) {
        // 409 refresh_in_progress: at most ONE retry, only with a DIFFERENT token.
        if (attempt >= 1) throw new RefreshHardReauthError();
        const reread = getCredentials();
        if (!reread?.refreshToken || reread.refreshToken === credentials.refreshToken) {
          // No different token available -> terminal, never re-present the same JTI.
          throw new RefreshHardReauthError();
        }
        await this.postRefreshWithRetry(reread, attempt + 1);
        return;
      }
      // Ambiguous (network/5xx): KEEP the marker, do not clear, do not assume "not rotated".
      throw err;
    }
    // Success: write new tokens AND clear the marker in the SAME write.
    // (Spreading ...credentials carries a pre-existing marker forward, so we must
    //  explicitly set pendingRefresh: undefined to clear it — omission alone does NOT
    //  strip a spread key. decidePendingRefresh treats undefined as "no marker".)
    storeCredentials({
      ...credentials,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      pendingRefresh: undefined, // explicit clear (overrides the spread)
    });
  }

  /**
   * Login with username and password
   */
  async login(username: string, password: string, totp?: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>({
      method: 'POST',
      path: '/auth/login',
      body: { username, password, totpCode: totp },
      skipAuth: true,
    });

    storeCredentials({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      userId: response.user.id,
      username: response.user.username,
      role: response.user.role,
      tenantId: response.user.tenantId,
    });

    return response;
  }

  /**
   * Make an HTTP request
   */
  async request<T>(options: RequestOptions): Promise<T> {
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

    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers,
      timeout: this.timeout,
      rejectUnauthorized: !this.insecure,
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
          try {
            // Parse response - empty string becomes empty object for successful responses
            const parsed: unknown = data ? JSON.parse(data) : (statusCode === 204 ? undefined : {});

            if (statusCode >= 400) {
              // v3.3.0: on a 401, transparently try a token refresh
              // once and replay the request. The server returns 401
              // not just for "no token" but also for "token's JTI
              // isn't in the session store" — which happens after a
              // server restart even if the token's clock-based exp
              // is still in the future. Without this retry the user
              // sees "session expired" and has to log in again on
              // every deploy. The _retriedAfter401Refresh flag stops
              // infinite recursion if the refresh itself doesn't
              // help (refresh token is invalid, etc.).
              if (
                statusCode === 401 &&
                !options.skipAuth &&
                !options._retriedAfter401Refresh
              ) {
                const credentials = getCredentials();
                // §A.1 gate: the 401-replay path is the SECOND refresh entry
                // point (it bypasses the in-process refreshPromise mutex). It
                // must also refuse to present a past-TTL marked token.
                const replayDecision = decidePendingRefresh();
                if (credentials?.refreshToken && replayDecision.action !== 'clean-relogin') {
                  // skipIfLive=false: the token is clock-valid but server-rejected
                  // here (v3.3.0 fix), so force a real refresh — never short-circuit.
                  this.refreshToken({ skipIfLive: false })
                    .then(() => {
                      // Recurse with the retry flag set, using the
                      // freshly-stored credentials.
                      return this.request<T>({
                        ...options,
                        _retriedAfter401Refresh: true,
                      });
                    })
                    .then(resolve)
                    .catch(reject);
                  return;
                }
                if (replayDecision.action === 'clean-relogin') {
                  logPendingRefreshRecovery(replayDecision.reason); // A3 observability
                }
              }
              if (isApiErrorLike(parsed)) {
                const errorMessage = parsed.message ?? parsed.error ?? `Request failed with status ${statusCode}`;
                const e = new Error(errorMessage);
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
                };
                ext.statusCode = statusCode;
                if (parsed.error !== undefined) ext.errorCode = parsed.error;
                if (parsed.steps !== undefined) ext.steps = parsed.steps;
                ext.details = parsed;
                reject(e);
              } else {
                const e = new Error(`HTTP ${statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`);
                (e as Error & { statusCode?: number }).statusCode = statusCode;
                reject(e);
              }
            } else {
              // Validate response shape before returning
              validateResponseShape(parsed, statusCode);
              resolve(parsed as T);
            }
          } catch (parseError) {
            if (statusCode >= 400) {
              reject(new Error(`Request failed with status ${statusCode}`));
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
