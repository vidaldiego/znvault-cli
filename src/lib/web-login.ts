// Path: src/lib/web-login.ts

/**
 * Web-based login module for CLI
 *
 * Implements browser-based authentication using a PKCE OAuth-like flow.
 * This allows users to authenticate via the vault dashboard which supports
 * all auth methods including 2FA and passkeys.
 *
 * Flow:
 * 1. CLI generates state + PKCE code_verifier/challenge
 * 2. CLI starts local HTTP server on localhost
 * 3. CLI opens browser to vault dashboard /cli-auth page
 * 4. User authenticates in browser (supports 2FA, passkeys)
 * 5. User clicks "Authorize CLI"
 * 6. Browser redirects to CLI's localhost callback
 * 7. CLI exchanges code for tokens via /auth/cli/token
 * 8. CLI stores credentials and shows success
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { getConfig, storeCredentials } from './config.js';
import * as output from './output.js';

// Dynamic import for 'open' package (ESM)
async function openBrowser(url: string): Promise<void> {
  const open = (await import('open')).default;
  await open(url);
}

// Version for CLI identification
const CLI_VERSION = '2.20.2';

// Configuration
const CALLBACK_PATH = '/callback';
const PORT_RANGE_START = 49152;
const PORT_RANGE_END = 65535;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// PKCE parameters
interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

// Token response from server
interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: string;
    tenantId: string | null;
    mfaVerified: boolean;
  };
}

// Callback result
interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Generate PKCE parameters
 */
function generatePKCE(): PKCEParams {
  // Generate code verifier (43-128 characters, URL-safe)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // Generate code challenge (SHA-256 hash of verifier, URL-safe base64)
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash.toString('base64url');

  // Generate state (random, for CSRF protection)
  const state = crypto.randomBytes(32).toString('base64url');

  return { codeVerifier, codeChallenge, state };
}

/**
 * Find an available port in the ephemeral range
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Start local callback server and wait for authorization
 */
function startCallbackServer(
  port: number,
  expectedState: string,
  timeoutMs: number
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const sockets = new Set<import('node:net').Socket>();

    const server = http.createServer((req, res) => {
      // Disable keep-alive to allow quick server shutdown
      res.setHeader('Connection', 'close');
      if (resolved) {
        res.writeHead(200);
        res.end('Already processed');
        return;
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      // Handle error from authorization
      if (error) {
        resolved = true;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h1 style="color: #dc2626;">Authorization Failed</h1>
            <p>${errorDescription ?? error}</p>
            <p style="color: #666;">You can close this window.</p>
          </body>
          </html>
        `);
        forceClose();
        reject(new Error(errorDescription ?? error));
        return;
      }

      // Validate required parameters
      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Invalid Request</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h1 style="color: #dc2626;">Invalid Request</h1>
            <p>Missing required parameters.</p>
          </body>
          </html>
        `);
        return;
      }

      // Validate state matches
      if (state !== expectedState) {
        resolved = true;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Security Error</title></head>
          <body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h1 style="color: #dc2626;">Security Error</h1>
            <p>State mismatch - possible CSRF attack.</p>
            <p style="color: #666;">You can close this window.</p>
          </body>
          </html>
        `);
        forceClose();
        reject(new Error('State mismatch - possible CSRF attack'));
        return;
      }

      // Success!
      resolved = true;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Success</title></head>
        <body style="font-family: system-ui; text-align: center; padding: 40px;">
          <h1 style="color: #22c55e;">Success!</h1>
          <p>Authorization complete. You can close this window.</p>
          <p style="color: #666;">Returning to CLI...</p>
        </body>
        </html>
      `);

      forceClose();
      resolve({ code, state });
    });

    // Track connections for forced shutdown
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    // Helper to forcefully close server and all connections
    const forceClose = () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server.close();
    };

    server.listen(port, '127.0.0.1', () => {
      // Server started
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // Timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        forceClose();
        reject(new Error('Authorization timed out. Please try again.'));
      }
    }, timeoutMs);

    // Cleanup timeout on resolve
    server.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Exchange auth code for tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state: string
): Promise<TokenResponse> {
  const config = getConfig();

  // Parse URL and build token endpoint
  const baseUrl = config.url.replace(/\/$/, '');
  const tokenUrl = `${baseUrl}/auth/cli/token`;

  // Make request
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      codeVerifier,
      state,
    }),
  });

  if (!response.ok) {
    const data = await response.json() as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? 'Token exchange failed');
  }

  return await response.json() as TokenResponse;
}

/**
 * Web-based login flow
 *
 * Opens a browser for authentication, waits for callback,
 * and exchanges the code for tokens.
 */
export async function webLogin(): Promise<{
  success: boolean;
  user?: TokenResponse['user'];
  error?: string;
}> {
  const config = getConfig();

  try {
    // 1. Generate PKCE parameters
    const pkce = generatePKCE();

    // 2. Find available port for callback server
    const port = await findAvailablePort();
    const callbackUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    // 3. Build auth URL
    const baseUrl = config.url.replace(/\/$/, '');
    const authUrl = new URL(`${baseUrl}/cli-auth`);
    authUrl.searchParams.set('callback_uri', callbackUri);
    authUrl.searchParams.set('state', pkce.state);
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('cli_version', CLI_VERSION);

    // 4. Show instructions
    output.info('Opening browser for authentication...');
    output.info(`If browser doesn't open, visit: ${authUrl.toString()}`);
    console.log('');
    output.info('Waiting for authorization (timeout: 5 minutes)...');

    // 5. Start callback server (before opening browser)
    const callbackPromise = startCallbackServer(port, pkce.state, AUTH_TIMEOUT_MS);

    // 6. Open browser
    try {
      await openBrowser(authUrl.toString());
    } catch {
      output.warn('Failed to open browser automatically.');
      output.info(`Please open this URL manually: ${authUrl.toString()}`);
    }

    // 7. Wait for callback
    const callbackResult = await callbackPromise;

    output.info('Authorization received. Exchanging for tokens...');

    // 8. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      callbackResult.code,
      pkce.codeVerifier,
      callbackResult.state
    );

    // 9. Store credentials
    storeCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      userId: tokens.user.id,
      username: tokens.user.username,
      role: tokens.user.role,
      tenantId: tokens.user.tenantId,
    });

    return {
      success: true,
      user: tokens.user,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Web login failed';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Check if web login is supported (requires fetch API)
 */
export function isWebLoginSupported(): boolean {
  return typeof fetch !== 'undefined';
}
