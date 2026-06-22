// Path: src/lib/ssh-tunnel.ts

/**
 * SSH-CA-authenticated tunnel manager for reaching loopback-bound agents.
 *
 * Production agents bind their control/health server (:9100) to 127.0.0.1 only,
 * so direct `http://<host>:9100` is unreachable from an operator's machine. This
 * helper opens a local port-forward via `znvault ssh forward --print-port`
 * (which authenticates with the vault SSH CA and honors the active profile's
 * configured SSH user), then exposes the agent at `127.0.0.1:<localPort>`.
 *
 * Ported from znvault-plugin-payara's ssh-tunnel.ts so the CLI owns its own copy
 * (the CLI must not import from a plugin package).
 */

import { spawn, type ChildProcess } from 'node:child_process';

/** An open tunnel: the local port to use, and a teardown. */
export interface Tunnel {
  host: string;
  localPort: number;
  /** PID of the spawned `znvault ssh forward` child (for orphan-kill backstops). */
  pid?: number;
  close(): Promise<void>;
}

export interface OpenTunnelOptions {
  /** Remote agent port to forward to (default 9100). */
  remotePort?: number;
  /** SSH user override; when omitted, `znvault ssh forward` uses the profile default. */
  user?: string;
  /** Max ms to wait for /health to answer through the tunnel (default 15000). */
  readinessTimeoutMs?: number;
}

const DEFAULT_REMOTE_PORT = 9100;
const DEFAULT_READINESS_TIMEOUT_MS = 15000;
const READINESS_POLL_INTERVAL_MS = 250;

/**
 * Resolve the znvault binary to shell out to. The forward runs as a child of the
 * current process, so the running binary itself is the correct one to re-invoke.
 */
function resolveZnvaultBin(): string {
  const fromEnv = process.env.ZNVAULT_BIN;
  if (fromEnv) return fromEnv;
  // process.argv[1] is the CLI entrypoint when run as `znvault ...`.
  return process.argv[1] ?? 'znvault';
}

/**
 * Open an SSH-CA-authenticated local forward to `host:remotePort` via
 * `znvault ssh forward --print-port`. Resolves once the tunnel's local port
 * answers `GET /health`, or rejects on spawn/exit/readiness failure.
 *
 * The caller MUST call `close()` (a `try/finally` is the intended pattern) to
 * tear the forward down.
 */
export async function openTunnel(host: string, opts: OpenTunnelOptions = {}): Promise<Tunnel> {
  const bin = resolveZnvaultBin();
  const remotePort = opts.remotePort ?? DEFAULT_REMOTE_PORT;
  const readinessTimeoutMs = opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;

  const target = opts.user ? `${opts.user}@${host}` : host;
  const args = [
    'ssh', 'forward',
    '--print-port',
    '-L', `127.0.0.1:0:127.0.0.1:${remotePort}`,
    target,
  ];

  const child: ChildProcess = spawn(bin, args, { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });

  const localPort = await new Promise<number>((resolve, reject) => {
    let buf = '';
    let settled = false;
    const onClose = (code: number | null): void => {
      if (!settled) {
        settled = true;
        reject(new Error(`ssh forward exited (code ${code ?? 'null'}) before reporting a port`));
      }
    };
    const onError = (err: Error): void => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    child.on('close', onClose);
    child.on('error', onError);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1); // consume the line
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as { localPort?: number };
          if (typeof parsed.localPort === 'number') {
            settled = true;
            child.removeListener('close', onClose);
            child.removeListener('error', onError);
            resolve(parsed.localPort);
            return;
          }
        } catch {
          /* not the JSON line; try the next one */
        }
      }
    });
  });

  const close = async (): Promise<void> => {
    if (child.pid && !child.killed) child.kill('SIGTERM');
    // Give it a beat to die; don't hang on a lingering child.
    await new Promise((r) => setTimeout(r, 100));
  };

  // App-level readiness: poll /health through the forward before returning.
  const deadline = Date.now() + readinessTimeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${localPort}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))),
      });
      if (res.ok) return { host, localPort, pid: child.pid, close };
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS));
  }
  await close();
  throw new Error(`Tunnel to ${host} opened (port ${localPort}) but /health never answered: ${lastErr}`);
}

/**
 * Whether a host is loopback (already locally reachable, no tunnel needed).
 */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Run `fn` against an agent reachable at `host:port`, opening an SSH-CA tunnel
 * first when needed and tearing it down afterward.
 *
 * Tunnel is skipped (direct connection used) when `tunnel` is false or the host
 * is loopback. When tunneling, `fn` receives `127.0.0.1` + the local forward
 * port; otherwise it receives the original host/port.
 */
export async function withAgentConnection<T>(
  host: string,
  port: number,
  opts: { tunnel: boolean },
  fn: (connHost: string, connPort: number) => Promise<T>,
): Promise<T> {
  if (!opts.tunnel || isLoopbackHost(host)) {
    return fn(host, port);
  }

  const tunnel = await openTunnel(host, { remotePort: port });
  try {
    return await fn('127.0.0.1', tunnel.localPort);
  } finally {
    await tunnel.close();
  }
}
