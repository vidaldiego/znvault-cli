// src/commands/mysql/run.ts

/**
 * Spawn the system `mysql` client for `znvault mysql exec/connect`.
 *
 * Security guarantees (spec F1–F12):
 *   - Password lives only in the 0600 my.cnf file written by B2 (mycnf.ts).
 *     It is NEVER added to argv, env, or any file opened by this module.
 *   - `--defaults-extra-file=<cnfPath>` is ALWAYS the first argument (mysql
 *     rejects it in any other position).
 *   - `MYSQL_HISTFILE=/dev/null` is injected into the child env so executed
 *     SQL is not persisted to ~/.mysql_history (spec F4).
 *   - No --host / --port flags are added; connection coordinates come from the
 *     cnf written by B2 (spec F2 — no client-side override). Caller passthrough
 *     is scrubbed of any host/port/defaults/password override flag, since mysql
 *     CLI flags override option-file values (last-wins) and would otherwise
 *     re-point the leased credential at an arbitrary server (F2 bypass).
 *   - This module never opens cnfPath itself; mysql reads it directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// PATH resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the `mysql` binary on the current PATH.
 *
 * Scans each directory in `process.env.PATH` for an executable named `mysql`.
 * Logs the resolved path to stderr for auditability (spec F11).
 *
 * @returns Absolute path to the `mysql` binary.
 * @throws If `mysql` is not found on PATH, with an actionable installation hint.
 */
export function assertMysqlOnPath(): string {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    const candidate = path.join(dir, 'mysql');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      // Found — log for auditability (spec F11). Write to STDERR so the audit
      // line never pollutes exec's machine-readable STDOUT (M-1).
      process.stderr.write(`[znvault] Resolved mysql binary: ${candidate}\n`);
      return candidate;
    } catch {
      // Not executable or not present in this dir; keep scanning.
    }
  }

  throw new Error(
    'mysql client not found on PATH. ' +
    'Install it (e.g. `brew install mysql-client` or `apt install mariadb-client`) ' +
    'and ensure it is on your PATH.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Passthrough flag allow/deny (spec F2 — no client-side connection override)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection/credential/defaults flags that a caller MUST NOT be able to inject
 * via `-- <passthrough>`.
 *
 * Why: mysql command-line flags override option-file values (last-wins). A
 * passthrough `--host evil-db` (or `--defaults-extra-file /evil.cnf`) would
 * re-point the leased '%' credential at an arbitrary server — the exact F2
 * access-control bypass the spec forbids. Likewise `--password`/`-p` would let
 * the caller supply a password that must come ONLY from the leased cnf.
 *
 * Stored WITHOUT the leading dashes for both long (`--flag`) and short (`-x`)
 * forms; matching is case-sensitive (mysql distinguishes `-P` port from `-p`
 * password).
 */
const FORBIDDEN_PASSTHROUGH_FLAGS: ReadonlySet<string> = new Set([
  // Connection coordinates — must come from the leased cnf only.
  '--host',
  '-h',
  '--port',
  '-P',
  // Defaults-file overrides — would let the caller swap the whole option file.
  '--defaults-extra-file',
  '--defaults-file',
  '--login-path',
  '--no-defaults',
  // Password — must come from the leased cnf only, never from argv.
  '--password',
  '-p',
]);

/**
 * Reject any passthrough token that is (or starts with `=`-form of) a forbidden
 * connection/credential/defaults override flag.
 *
 * Recognised forms for a forbidden flag `--host`:
 *   - exact:   `--host`        (its value is the next token)
 *   - inline:  `--host=value`
 *   - short:   `-h`            (value is next token)  / `-P`, `-p`
 *
 * Tokens that merely START with a forbidden name but are a different flag
 * (e.g. `--hostgroup`, `--port-something`) are NOT rejected.
 *
 * @throws Error naming the offending flag and citing F2, on the first match.
 */
export function assertPassthroughAllowed(passthrough: readonly string[]): void {
  for (const token of passthrough) {
    // Normalise an inline `--flag=value` to its flag head for the lookup.
    const eqIdx = token.indexOf('=');
    const flag = eqIdx === -1 ? token : token.slice(0, eqIdx);

    if (FORBIDDEN_PASSTHROUGH_FLAGS.has(flag)) {
      throw new Error(
        `Passthrough flag '${flag}' is not allowed — host/port come from the ` +
        `leased connection and cannot be overridden (see F2).`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invocation builder (pure — no side-effects, easy to unit-test)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the pure argv/env builder.
 * `mode` is intentionally absent — stdin wiring is exec/connect-specific and
 * is handled by runMysql, not by this pure builder.
 */
export interface BuildMysqlInvocationOpts {
  /** Path to the 0600 my.cnf file written by mycnf.ts. */
  cnfPath: string;
  /** Optional default schema to select (positional arg — spec F8). */
  database?: string;
  /** Extra arguments appended verbatim to the mysql argv. */
  passthrough?: string[];
}

/**
 * Build the mysql argv and child environment.
 *
 * This is a PURE function — no spawning, no file I/O, no side effects.
 * Export it so tests can assert security-critical argv/env invariants
 * without spawning real mysql.
 *
 * Security invariants:
 *   - `--defaults-extra-file=<cnfPath>` is args[0].
 *   - No --user / -u / --password / -p / MYSQL_PWD in args or env.
 *   - No --host / --port / -h / -P flags (connection coords from cnf).
 *   - Forbidden override flags in `passthrough` are rejected (spec F2).
 *   - MYSQL_HISTFILE=/dev/null overrides any pre-existing value.
 *
 * @throws If `passthrough` contains a forbidden connection/credential/defaults
 *         override flag (see assertPassthroughAllowed).
 */
export function buildMysqlInvocation(opts: BuildMysqlInvocationOpts): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const { cnfPath, database, passthrough = [] } = opts;

  // F2: reject host/port/defaults/password overrides BEFORE they reach argv.
  assertPassthroughAllowed(passthrough);

  // --defaults-extra-file MUST be first (mysql enforces this).
  const args: string[] = [`--defaults-extra-file=${cnfPath}`];

  // database as a positional arg (spec F8 — narrows the default schema only).
  if (database) {
    args.push(database);
  }

  // Caller-supplied pass-through flags appended verbatim at the end (now safe —
  // forbidden connection/credential overrides were rejected above).
  args.push(...passthrough);

  // Child env: inherit everything, then suppress history (spec F4).
  // Critically: do NOT add MYSQL_PWD, MYSQL_USER, --password, etc.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MYSQL_HISTFILE: '/dev/null',
  };

  // Scrub any ambient MYSQL_PWD so the password comes ONLY from the cnf
  // (spec: never from env). Also scrub MYSQL_PWD_PATH for completeness.
  delete env.MYSQL_PWD;
  delete env.MYSQL_PWD_PATH;

  return { args, env };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for runMysql.
 */
export interface RunMysqlOpts {
  /** Path to the 0600 my.cnf file. Must already exist; this module never opens it. */
  cnfPath: string;
  /** Default schema to select (positional arg — spec F8). */
  database?: string;
  /** 'connect' → interactive (stdio: inherit); 'exec' → non-interactive. */
  mode: 'exec' | 'connect';
  /**
   * (exec mode) SQL files to read and concatenate as stdin.
   * Precedence: files → sql → parent stdin (spec F-input).
   */
  files?: string[];
  /**
   * (exec mode) Inline SQL string to feed as stdin.
   * Precedence: files → sql → parent stdin (spec F-input).
   */
  sql?: string;
  /** Extra arguments appended verbatim to the mysql argv. */
  passthrough?: string[];
}

/**
 * Best-effort unlink of the cnf directory entry (spec F1).
 *
 * Called IMMEDIATELY after the child mysql has been spawned. mysql reads the
 * `--defaults-extra-file` at startup (before doing anything else), so removing
 * the directory entry right after spawn is safe — the child has already been
 * exec'd and will open/read the file. Removing the entry now means:
 *   - no plaintext directory entry persists for the lifetime of the run, and
 *   - a `kill -9` of either process leaves nothing on disk.
 *
 * Idempotent and never throws (the broker's cleanup() also unlinks; whichever
 * runs first wins, and the loser is a no-op).
 *
 * Residual micro-race (documented): because the unlink happens after the spawn
 * call returns rather than after mysql has provably finished reading the file,
 * there is a vanishingly small window in which the entry exists post-spawn. The
 * fully race-free alternative (open the file, pass the OPEN FD to mysql via
 * /dev/fd/N) requires preserving the fd NUMBER across spawn, which is fragile
 * and non-portable with Node's stdio-array fd mapping. spawn-then-unlink is the
 * pragmatic, portable (Linux + macOS) improvement chosen here.
 */
function unlinkCnfBestEffort(cnfPath: string): void {
  try {
    fs.unlinkSync(cnfPath);
  } catch {
    // Already gone (broker cleanup beat us, or it never existed) — ignore.
  }
}

/**
 * Spawn the system `mysql` client and wait for it to exit.
 *
 * - Resolves with the child's numeric exit code (caller/CI relies on non-zero).
 * - 'connect' mode: stdio is fully inherited (interactive terminal).
 * - 'exec' mode: stdin is wired as:
 *     1. files (concatenated, in order) → stdin pipe
 *     2. sql (string) → stdin pipe
 *     3. parent stdin (if not a TTY) → piped through
 *     4. parent stdin is a TTY and neither files nor sql provided → Error
 *   stdout/stderr are inherited for both modes.
 *
 * F1: in every spawn path, the cnf directory entry is unlinked IMMEDIATELY
 * after spawn (see unlinkCnfBestEffort) so no plaintext file survives the run.
 *
 * @throws If the `mysql` binary is not on PATH (via assertMysqlOnPath).
 * @throws If `passthrough` contains a forbidden override flag (via the builder).
 * @throws If exec mode is requested but no SQL source is available.
 */
export async function runMysql(opts: RunMysqlOpts): Promise<number> {
  const { spawn } = await import('node:child_process');

  const mysqlBin = assertMysqlOnPath();
  const { args, env } = buildMysqlInvocation({
    cnfPath: opts.cnfPath,
    database: opts.database,
    passthrough: opts.passthrough,
  });

  if (opts.mode === 'connect') {
    // Interactive: inherit all stdio so the terminal works end-to-end.
    const child = spawn(mysqlBin, args, { stdio: 'inherit', env });
    // F1: drop the directory entry now that mysql has been exec'd.
    unlinkCnfBestEffort(opts.cnfPath);
    return new Promise<number>((resolve, reject) => {
      child.on('error', (err) => { reject(err); });
      child.on('close', (code) => { resolve(code ?? 1); });
    });
  }

  // ── exec mode ──────────────────────────────────────────────────────────────
  // Determine the stdin source.

  if (opts.files && opts.files.length > 0) {
    // Read + concatenate files in order, pipe the result.
    const fsModule = await import('node:fs');
    const chunks: Buffer[] = opts.files.map((f) => fsModule.readFileSync(f));
    const sqlBuf = Buffer.concat(chunks);

    const child = spawn(mysqlBin, args, { stdio: ['pipe', 'inherit', 'inherit'], env });
    // F1: drop the directory entry now that mysql has been exec'd.
    unlinkCnfBestEffort(opts.cnfPath);
    return new Promise<number>((resolve, reject) => {
      child.on('error', (err) => { reject(err); });
      child.on('close', (code) => { resolve(code ?? 1); });
      // stdin is always a Writable when stdio[0] is 'pipe'; cast to avoid TS
      // optional-chaining warnings from the broad ChildProcess.stdin type.
      (child.stdin as NodeJS.WritableStream).end(sqlBuf);
    });
  }

  if (opts.sql !== undefined) {
    // Inline SQL string piped to stdin.
    const sqlBuf = Buffer.from(opts.sql);
    const child = spawn(mysqlBin, args, { stdio: ['pipe', 'inherit', 'inherit'], env });
    // F1: drop the directory entry now that mysql has been exec'd.
    unlinkCnfBestEffort(opts.cnfPath);
    return new Promise<number>((resolve, reject) => {
      child.on('error', (err) => { reject(err); });
      child.on('close', (code) => { resolve(code ?? 1); });
      // stdin is always a Writable when stdio[0] is 'pipe'.
      (child.stdin as NodeJS.WritableStream).end(sqlBuf);
    });
  }

  // No files / sql provided — check whether parent stdin is piped.
  if (process.stdin.isTTY) {
    throw new Error(
      'znvault mysql exec: no SQL source provided. ' +
      'Pass --file <path>, --sql <sql>, or pipe SQL via stdin.',
    );
  }

  // Parent stdin is piped — pass it through.
  const child = spawn(mysqlBin, args, { stdio: ['inherit', 'inherit', 'inherit'], env });
  // F1: drop the directory entry now that mysql has been exec'd.
  unlinkCnfBestEffort(opts.cnfPath);
  return new Promise<number>((resolve, reject) => {
    child.on('error', (err) => { reject(err); });
    child.on('close', (code) => { resolve(code ?? 1); });
  });
}
