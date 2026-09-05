import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Mock config module to prevent tests from writing to real config / doing
// token refresh (we only care about the 4xx/5xx error-body passthrough path).
vi.mock('../../src/lib/config.js', () => ({
  storeCredentials: vi.fn(),
  getCredentials: vi.fn().mockReturnValue(null),
  clearCredentials: vi.fn(),
  isTokenExpired: vi.fn().mockReturnValue(true),
  hasEnvCredentials: vi.fn().mockReturnValue(false),
  getEnvCredentials: vi.fn().mockReturnValue(undefined),
  hasApiKey: vi.fn().mockReturnValue(false),
  getApiKey: vi.fn().mockReturnValue(undefined),
  getConfig: vi.fn().mockImplementation(() => ({
    url: process.env.ZNVAULT_URL ?? 'http://localhost:8443',
    insecure: false,
    timeout: 30000,
  })),
  getEffectiveUrl: vi.fn().mockImplementation(() => process.env.ZNVAULT_URL ?? 'http://localhost:8443'),
  writePendingRefreshMarker: vi.fn(),
  decidePendingRefresh: vi.fn(() => ({ action: 'none' })),
  decodeRefreshJti: vi.fn(),
  logPendingRefreshRecovery: vi.fn(),
  getActiveProfileName: vi.fn(() => 'default'),
  invalidateProfileCache: vi.fn(),
}));

describe('HttpClient error-body passthrough', () => {
  let server: http.Server;

  afterEach(async () => {
    delete process.env.ZNVAULT_URL;
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    vi.resetModules();
  });

  it('attaches errorCode and steps from a 422 provision-report body to the thrown Error', async () => {
    const responseBody = {
      error: 'root_insufficient',
      message: 'Root credential lacks required grants',
      steps: [
        { step: 'lock', status: 'acquired' },
        { step: 'preflight', status: 'failed' },
      ],
    };

    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 422;
      res.end(JSON.stringify(responseBody));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
    const address = server.address() as AddressInfo;
    process.env.ZNVAULT_URL = `http://127.0.0.1:${address.port}`;

    const { HttpClient } = await import('../../src/lib/client/http.js');
    const httpClient = new HttpClient();

    let caught: unknown;
    try {
      await httpClient.post('/v1/dynamic-secrets/connections/provision', {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const e = caught as Error & { statusCode?: number; errorCode?: string; steps?: unknown[] };
    expect(e.statusCode).toBe(422);
    expect(e.errorCode).toBe('root_insufficient');
    expect(e.steps).toEqual([
      { step: 'lock', status: 'acquired' },
      { step: 'preflight', status: 'failed' },
    ]);
  });

  it('does not attach steps/errorCode when the error body has none of those fields', async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 400;
      res.end(JSON.stringify({ message: 'Bad request' }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
    const address = server.address() as AddressInfo;
    process.env.ZNVAULT_URL = `http://127.0.0.1:${address.port}`;

    const { HttpClient } = await import('../../src/lib/client/http.js');
    const httpClient = new HttpClient();

    let caught: unknown;
    try {
      await httpClient.get('/v1/whatever');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const e = caught as Error & { statusCode?: number; errorCode?: string; steps?: unknown[] };
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('Bad request');
    expect(e.errorCode).toBeUndefined();
    expect(e.steps).toBeUndefined();
  });

  it('preserves and renders the server symbolic code when code and generic error are both present', async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 403;
      res.end(JSON.stringify({
        error: 'Forbidden',
        code: 'SECRET_REQUIRES_USER_SESSION',
        message: 'A password-authenticated user session is required',
      }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
    const address = server.address() as AddressInfo;
    process.env.ZNVAULT_URL = `http://127.0.0.1:${address.port}`;

    const { HttpClient } = await import('../../src/lib/client/http.js');
    const httpClient = new HttpClient();

    let caught: unknown;
    try {
      await httpClient.post('/v1/secrets/example/decrypt', {});
    } catch (err) {
      caught = err;
    }

    const error = caught as Error & { statusCode?: number; errorCode?: string };
    expect(error.message).toBe(
      'SECRET_REQUIRES_USER_SESSION: A password-authenticated user session is required',
    );
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('SECRET_REQUIRES_USER_SESSION');
  });
});
