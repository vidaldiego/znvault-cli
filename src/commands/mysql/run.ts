// src/commands/mysql/run.ts

/**
 * Spawn the system `mysql` client for `znvault mysql exec/connect`.
 *
 * Security guarantees (spec F1–F12):
 *   - Password lives only in the 0600 my.cnf inode written by B2 (mycnf.ts).
 *     It is NEVER added to argv, env, or any file opened by this module.
 *   - The cnf is passed to mysql as an OPEN FILE DESCRIPTOR via /dev/fd/<fd>
 *     (spec F1). createMyCnf opens the file, writes the credentials, and unlinks
 *     the directory entry IMMEDIATELY — so there is no plaintext name on disk for
 *     the lifetime of the run. The inode is kept alive solely by the inherited
 *     fd; closing it (cleanup) reclaims the bytes. This removes the old
 *     "spawn-then-unlink" race: spawn() returns when the child is forked but
 *     BEFORE it exec's mysql and reads --defaults-extra-file, so unlinking after
 *     spawn could win the race and crash mysql with
 *     "Failed to open required defaults file".
 *   - `--defaults-extra-file=/dev/fd/<fd>` is ALWAYS the first argument (mysql
 *     rejects it in any other position).
 *   - The child INHERITS the fd at the SAME number N, so `/dev/fd/N` resolves to
 *     the same inode inside the child (see buildChildStdio).
 *   - `MYSQL_HISTFILE=/dev/null` is injected into the child env so executed
 *     SQL is not persisted to ~/.mysql_history (spec F4).
 *   - No --host / --port flags are added; connection coordinates come from the
 *     cnf written by B2 (spec F2 — no client-side override). Caller passthrough
 *     is scrubbed of any host/port/defaults/password override flag, since mysql
 *     CLI flags override option-file values (last-wins) and would otherwise
 *     re-point the leased credential at an arbitrary server (F2 bypass).
 *   - This module never re-opens the cnf path itself; mysql reads it via the
 *     inherited fd. The parent's own copy of the fd is released by cleanup()
 *     once the child has exited (spec F3 hygiene).
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
  /**
   * Value for `--defaults-extra-file`. This is the `/dev/fd/<fd>` path returned
   * by createMyCnf (B2) — mysql re-opens the inherited fd through it.
   */
  fdPath: string;
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
 *   - `--defaults-extra-file=<fdPath>` is args[0].
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
  const { fdPath, database, passthrough = [] } = opts;

  // F2: reject host/port/defaults/password overrides BEFORE they reach argv.
  assertPassthroughAllowed(passthrough);

  // --defaults-extra-file MUST be first (mysql enforces this).
  const args: string[] = [`--defaults-extra-file=${fdPath}`];

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
// stdio array construction (fd inheritance at the SAME number)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single entry of a child_process `stdio` array. A NUMBER means "inherit THIS
 * parent fd at this child index"; the strings are the usual stdio dispositions.
 */
type StdioEntry = 'pipe' | 'inherit' | 'ignore' | number;

/**
 * Build the `stdio` array for spawning mysql so that the cnf fd is inherited by
 * the child at the SAME numeric index `fd`. This is what makes
 * `--defaults-extra-file=/dev/fd/<fd>` resolve correctly in the child: the
 * child must have an fd open at exactly `fd`.
 *
 * Layout:
 *   - index 0 (stdin):  `stdin0` — 'pipe' for exec (we feed SQL), 'inherit' for
 *     connect (interactive terminal).
 *   - index 1 (stdout): 'inherit'.
 *   - index 2 (stderr): 'inherit'.
 *   - indices 3 .. fd-1: 'ignore' (gaps the array must fill; the child does not
 *     use them).
 *   - index fd:         `fd` (a number → inherit the parent fd at this index).
 *
 * `fd` is always >= 3 in practice (0/1/2 are taken by the std streams of the
 * Node process), so it never collides with stdin/stdout/stderr. We assert this
 * defensively.
 *
 * @param fd     The parent fd to inherit at the same number in the child.
 * @param stdin0 Disposition for the child's stdin (index 0).
 * @returns A stdio array of length max(3, fd+1).
 * @throws If `fd` is < 3 (would collide with std streams — never expected).
 */
export function buildChildStdio(fd: number, stdin0: 'pipe' | 'inherit'): StdioEntry[] {
  if (!Number.isInteger(fd) || fd < 3) {
    // 0/1/2 are reserved for stdin/stdout/stderr; the cnf fd must be a higher
    // descriptor. This would only happen if std streams were closed — bail
    // loudly rather than silently mis-wiring the credential fd.
    throw new Error(
      `Refusing to spawn mysql: cnf fd ${String(fd)} collides with a standard ` +
      `stream (must be >= 3). This indicates a closed stdin/stdout/stderr.`,
    );
  }

  const stdio: StdioEntry[] = new Array<StdioEntry>(Math.max(3, fd + 1));
  for (let i = 0; i < stdio.length; i++) {
    if (i === 0) stdio[i] = stdin0;
    else if (i === 1 || i === 2) stdio[i] = 'inherit';
    else stdio[i] = 'ignore';
  }
  // Place the credential fd at its own number so /dev/fd/<fd> resolves.
  stdio[fd] = fd;
  return stdio;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for runMysql.
 */
export interface RunMysqlOpts {
  /**
   * The `/dev/fd/<fd>` path returned by createMyCnf — passed to mysql as
   * --defaults-extra-file. This module never re-opens it; mysql reads the
   * inherited fd through it.
   */
  fdPath: string;
  /**
   * The numeric fd backing `fdPath`. The child INHERITS this fd at the SAME
   * number so `/dev/fd/<fd>` resolves inside it. The parent does NOT close it
   * here — createMyCnf's cleanup() owns the close (after the child exits).
   */
  fd: number;
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
 * Spawn the system `mysql` client and wait for it to exit.
 *
 * - Resolves with the child's numeric exit code (caller/CI relies on non-zero).
 * - The cnf fd (`opts.fd`) is inherited by the child at the SAME number so
 *   `--defaults-extra-file=/dev/fd/<fd>` resolves in the child (spec F1). The
 *   directory entry was already unlinked in createMyCnf — there is NOTHING to
 *   unlink here, and NO post-spawn unlink race.
 * - 'connect' mode: stdin/stdout/stderr are inherited (interactive terminal);
 *   the cnf fd is additionally inherited at index `fd`.
 * - 'exec' mode: stdin (index 0) is wired as:
 *     1. files (concatenated, in order) → stdin pipe
 *     2. sql (string) → stdin pipe
 *     3. parent stdin (if not a TTY) → piped through (inherit)
 *     4. parent stdin is a TTY and neither files nor sql provided → Error
 *   stdout/stderr are inherited; the cnf fd is inherited at index `fd`.
 *
 * The parent's own copy of `opts.fd` is intentionally NOT closed here — the
 * child holds its own dup (created by spawn's file actions), and createMyCnf's
 * cleanup() closes the parent's copy after this resolves. (Closing here would be
 * safe too, since the child already has its dup, but leaving the single owner —
 * cleanup() — avoids double-close races.)
 *
 * @throws If the `mysql` binary is not on PATH (via assertMysqlOnPath).
 * @throws If `passthrough` contains a forbidden override flag (via the builder).
 * @throws If the cnf fd collides with a standard stream (via buildChildStdio).
 * @throws If exec mode is requested but no SQL source is available.
 */
export async function runMysql(opts: RunMysqlOpts): Promise<number> {
  const { spawn } = await import('node:child_process');

  const mysqlBin = assertMysqlOnPath();
  const { args, env } = buildMysqlInvocation({
    fdPath: opts.fdPath,
    database: opts.database,
    passthrough: opts.passthrough,
  });

  if (opts.mode === 'connect') {
    // Interactive: inherit std streams + the cnf fd at its own number.
    const stdio = buildChildStdio(opts.fd, 'inherit');
    const child = spawn(mysqlBin, args, { stdio, env });
    return new Promise<number>((resolve, reject) => {
      child.on('error', (err) => { reject(err); });
      child.on('close', (code) => { resolve(code ?? 1); });
    });
  }

  // ── exec mode ──────────────────────────────────────────────────────────────
  // stdin (index 0) is 'pipe' when we feed SQL ourselves (files / sql), and
  // 'inherit' when we pass the parent's piped stdin through. The cnf fd (>= 3)
  // is a separate, higher index — no collision with stdin.

  if (opts.files && opts.files.length > 0) {
    // Read + concatenate files in order, pipe the result.
    const fsModule = await import('node:fs');
    const chunks: Buffer[] = opts.files.map((f) => fsModule.readFileSync(f));
    const sqlBuf = Buffer.concat(chunks);

    const stdio = buildChildStdio(opts.fd, 'pipe');
    const child = spawn(mysqlBin, args, { stdio, env });
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
    const stdio = buildChildStdio(opts.fd, 'pipe');
    const child = spawn(mysqlBin, args, { stdio, env });
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

  // Parent stdin is piped — pass it through (inherit) while still inheriting
  // the cnf fd at its own number.
  const stdio = buildChildStdio(opts.fd, 'inherit');
  const child = spawn(mysqlBin, args, { stdio, env });
  return new Promise<number>((resolve, reject) => {
    child.on('error', (err) => { reject(err); });
    child.on('close', (code) => { resolve(code ?? 1); });
  });
}
