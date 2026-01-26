// Path: src/lib/client/http.ts

/**
 * Base HTTP client functionality
 * Handles request making, authentication, and token refresh
 */

import https from 'node:https';
import http from 'node:http';
import {
  getConfig,
  getCredentials,
  getApiKey,
  hasApiKey,
  storeCredentials,
  isTokenExpired,
  getEnvCredentials,
  hasEnvCredentials,
} from '../config.js';
import * as output from '../output.js';
import type { RequestOptions, ClientConfig } from './types.js';
import type { LoginResponse } from '../../types/index.js';

/** Track if insecure warning has been shown (show only once per session) */
let insecureWarningShown = false;

/**
 * Type guard to check if a value looks like an API error response
 */
function isApiErrorLike(value: unknown): value is { message?: string; error?: string } {
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
  protected baseUrl: string;
  protected insecure: boolean;
  protected timeout: number;
  private refreshPromise: Promise<void> | null = null;

  constructor(config?: Partial<ClientConfig>) {
    const defaultConfig = getConfig();
    this.baseUrl = config?.baseUrl ?? defaultConfig.url;
    this.insecure = config?.insecure ?? defaultConfig.insecure;
    this.timeout = config?.timeout ?? defaultConfig.timeout;

    // Warn about insecure mode (once per session)
    if (this.insecure && !insecureWarningShown) {
      insecureWarningShown = true;
      output.warn('TLS certificate verification is disabled (--insecure or ZNVAULT_INSECURE=true)');
      output.warn('This is insecure and should only be used for development/testing');
    }
  }

  /**
   * Update client configuration
   */
  configure(url?: string, insecure?: boolean): void {
    if (url) this.baseUrl = url;
    if (insecure !== undefined) this.insecure = insecure;
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
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

    // Double-check pattern: After confirming token is expired, check again
    // if another caller started a refresh while we were checking
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    // We're the first to detect expiry - start the refresh
    this.refreshPromise = this.refreshToken().finally(() => {
      this.refreshPromise = null;
    });

    await this.refreshPromise;
  }

  /**
   * Refresh the access token
   */
  async refreshToken(): Promise<void> {
    const credentials = getCredentials();
    if (!credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.request<LoginResponse>({
      method: 'POST',
      path: '/auth/refresh',
      body: { refreshToken: credentials.refreshToken },
      skipAuth: true,
    });

    storeCredentials({
      ...credentials,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
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

    const requestOptions: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers,
      timeout: this.timeout,
      rejectUnauthorized: !this.insecure,
    };

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
              if (isApiErrorLike(parsed)) {
                const errorMessage = parsed.message ?? parsed.error ?? `Request failed with status ${statusCode}`;
                reject(new Error(errorMessage));
              } else {
                reject(new Error(`HTTP ${statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`));
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
