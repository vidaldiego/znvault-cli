// src/commands/mysql/broker.ts

/**
 * Brokered lease lifecycle for `znvault mysql exec/connect`.
 *
 * runBrokered:
 *   1. Generates a short-lived dynamic-secret credential.
 *   2. Writes credentials to a 0600 temp my.cnf on a memory-backed fs.
 *   3. Calls the injected `run` callback with { credential, cnfPath }.
 *   4. In ALL exit paths (normal return, run error, SIGINT/SIGTERM/SIGHUP,
 *      uncaughtException) — calls a single idempotent cleanup() that:
 *        a. Shreds + unlinks the temp my.cnf.
 *        b. Revokes the lease (3 retries: 1s/2s/4s backoff).
 *           "Already revoked" errors are treated as success.
 *           All retries exhausted → loud WARN with leaseId (TTL backstop).
 *   5. Returns the numeric exit code from run, or rethrows run's error.
 *
 * Security guarantees (spec F1–F12):
 *   - Password only in 0600 temp file, never in argv/env/stdout.
 *   - host/port MUST come from the server; no --host fallback (spec F2).
 *   - Lease is always revoked; TTL is the backstop, not the primary mechanism.
 *   - Signal handlers are removed in the finally block to avoid leaks.
 */

import { client } from '../../lib/client.js';
import { createMyCnf } from './mycnf.js';
import type { GeneratedCredential } from '../dynamic-secrets/types.js';

/** Default lease TTL in seconds (spec F12 — may be capped by role maxTtl). */
const DEFAULT_TTL_SECONDS = 600;

/** Backoff delays in ms for revoke retries. */
const REVOKE_BACKOFF_MS = [1_000, 2_000, 4_000];

/** Maximum retries for revoke (length of REVOKE_BACKOFF_MS + 1 initial attempt). */
const REVOKE_MAX_ATTEMPTS = 1 + REVOKE_BACKOFF_MS.length; // 4 total

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the error message indicates the lease is already revoked.
 * The server throws "Cannot revoke <id>: lease is already REVOKED" (or similar).
 *
 * TODO: also check the HTTP status code (e.g. 404/409) once the client surfaces
 * it on the error object — matching solely on err.message is fragile if the
 * server error wording changes.
 */
function isAlreadyRevoked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('cannot revoke') || msg.includes('already revoked') || msg.includes('already_revoked');
}

/**
 * Attempt to revoke the lease with up to REVOKE_MAX_ATTEMPTS tries.
 * "Already revoked" errors are silently treated as success.
 * If all attempts fail for other reasons, emits a loud WARN (does not throw).
 */
async function revokeWithRetry(leaseId: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= REVOKE_MAX_ATTEMPTS; attempt++) {
    try {
      await client.post(`/v1/dynamic-secrets/leases/${leaseId}/revoke`, {
        reason: 'znvault-mysql-exec-cleanup',
      });
      return; // success
    } catch (err) {
      if (isAlreadyRevoked(err)) {
        return; // treat as success
      }
      lastErr = err;
      // Sleep between retries; no sleep after the last attempt.
      if (attempt < REVOKE_MAX_ATTEMPTS) {
        await sleep(REVOKE_BACKOFF_MS[attempt - 1] ?? 1_000);
      }
    }
  }
  // All retries exhausted — log loud WARN so the operator can manually revoke.
  // Do NOT throw: the TTL backstop will clean up the DB user.
  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.warn(
    `[znvault] WARN: failed to revoke lease ${leaseId} after ${REVOKE_MAX_ATTEMPTS.toString()} attempts. ` +
    `It will expire at its TTL. Last error: ${errMsg}`,
  );
}

/**
 * Options for runBrokered.
 */
export interface RunBrokeredOptions {
  /** The dynamic-secrets role ID to generate credentials from. */
  roleId: string;
  /**
   * Requested TTL in seconds. The server may cap this to the role's maxTtl.
   * Defaults to DEFAULT_TTL_SECONDS (600).
   */
  ttlSeconds?: number;
  /**
   * Callback that receives the credential + path to the temp my.cnf.
   * Should return the numeric child process exit code.
   *
   * The my.cnf is valid for the duration of this callback.
   * The lease is revoked immediately after the callback returns (or throws).
   */
  run: (ctx: { credential: GeneratedCredential; cnfPath: string }) => Promise<number>;
}

/**
 * Generate a lease, write its credentials to a temp my.cnf, run the callback,
 * then revoke the lease and shred the my.cnf on EVERY exit path.
 *
 * @returns The numeric exit code returned by `run`.
 * @throws If `run` throws, the error is rethrown after cleanup.
 * @throws If the server does not return host/port in the credential,
 *         an upgrade error is thrown before `run` is called.
 */
export async function runBrokered(opts: RunBrokeredOptions): Promise<number> {
  const { roleId, run } = opts;
  const requestedTtl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  // ── 1. Generate lease ───────────────────────────────────────────────────────
  const credential = await client.post<GeneratedCredential>(
    `/v1/dynamic-secrets/roles/${roleId}/credentials`,
    { ttlSeconds: requestedTtl },
  );

  // Log the effective TTL (may differ from requested due to role maxTtl cap — spec F12).
  if (credential.ttlSeconds !== requestedTtl) {
    console.warn(
      `[znvault] Requested TTL ${requestedTtl.toString()}s was capped to ${credential.ttlSeconds.toString()}s by the role's maxTtl.`,
    );
  }

  // ── 2. Validate host/port (spec F2 — no --host fallback) ───────────────────
  if (!credential.host || credential.port === undefined) {
    // Revoke the just-minted lease before throwing. revokeWithRetry applies the
    // same retry/backoff as the main cleanup path (it does NOT skip retries).
    await revokeWithRetry(credential.leaseId);
    throw new Error(
      `Vault did not return host/port in the credential for role '${roleId}'. ` +
      `Please upgrade vault to a version that returns host/port in dynamic-secret credentials.`,
    );
  }

  // ── 3. Write temp my.cnf ────────────────────────────────────────────────────
  // The lease is minted but the idempotent cleanup()/try-finally below is not
  // installed yet. If createMyCnf throws (disk full, mkdir race, EMFILE) here,
  // the lease would be orphaned (only the TTL backstop would save it). Revoke it
  // first, then rethrow. No double-revoke risk: cleanup() is not installed until
  // after this succeeds, so on this path revoke fires exactly once (I-2).
  let cnfPath: string;
  let cleanupCnf: () => void;
  try {
    ({ path: cnfPath, cleanup: cleanupCnf } = await createMyCnf({
      user: credential.username,
      password: credential.password,
      host: credential.host,
      port: credential.port,
    }));
  } catch (err) {
    await revokeWithRetry(credential.leaseId);
    throw err;
  }

  // ── 4. Idempotent cleanup (guarded by `cleaned` boolean) ───────────────────
  let cleaned = false;
  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;
    cleanupCnf();
    await revokeWithRetry(credential.leaseId);
  }

  // ── 5. Signal handlers ──────────────────────────────────────────────────────
  // SIGPIPE is intentionally not handled — treat as normal (don't crash).
  // Each handler uses an async IIFE so cleanup() is properly awaited before
  // process.exit. The outer `void` is the lint-clean way to fire-and-forget an
  // async function from a synchronous signal handler — cleanup() cannot throw
  // (revokeWithRetry eats errors, cleanupCnf is try/caught), so there is no
  // unhandled rejection risk.
  const onSIGINT = (): void => { void (async () => { await cleanup(); process.exit(130); })(); };
  const onSIGTERM = (): void => { void (async () => { await cleanup(); process.exit(143); })(); };
  const onSIGHUP = (): void => { void (async () => { await cleanup(); process.exit(129); })(); };
  const onUncaughtException = (err: Error): void => {
    console.error('[znvault] Uncaught exception during mysql exec:', err.stack ?? err);
    void (async () => { await cleanup(); process.exit(1); })();
  };

  process.once('SIGINT', onSIGINT);
  process.once('SIGTERM', onSIGTERM);
  process.once('SIGHUP', onSIGHUP);
  process.once('uncaughtException', onUncaughtException);

  // ── 6. Run callback + cleanup in finally ────────────────────────────────────
  try {
    const exitCode = await run({ credential, cnfPath });
    return exitCode;
  } finally {
    // Remove signal handlers BEFORE awaiting cleanup so that a signal arriving
    // during cleanup does not re-enter the handler (which would be a no-op due
    // to the `cleaned` guard but would also leak across repeated runBrokered calls).
    process.off('SIGINT', onSIGINT);
    process.off('SIGTERM', onSIGTERM);
    process.off('SIGHUP', onSIGHUP);
    process.off('uncaughtException', onUncaughtException);
    await cleanup();
  }
}
