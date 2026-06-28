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
 *     cnf written by B2 (spec F2 — no client-side override).
 *   - This module never opens cnfPath itself; mysql reads it directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as output from '../../lib/output.js';

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
      // Found — log for auditability (spec F11).
      output.info(`[znvault] Resolved mysql binary: ${candidate}`);
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
 *   - MYSQL_HISTFILE=/dev/null overrides any pre-existing value.
 */
export function buildMysqlInvocation(opts: BuildMysqlInvocationOpts): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const { cnfPath, database, passthrough = [] } = opts;

  // --defaults-extra-file MUST be first (mysql enforces this).
  const args: string[] = [`--defaults-extra-file=${cnfPath}`];

  // database as a positional arg (spec F8 — narrows the default schema only).
  if (database) {
    args.push(database);
  }

  // Caller-supplied pass-through flags appended verbatim at the end.
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
 * @throws If the `mysql` binary is not on PATH (via assertMysqlOnPath).
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
  return new Promise<number>((resolve, reject) => {
    child.on('error', (err) => { reject(err); });
    child.on('close', (code) => { resolve(code ?? 1); });
  });
}
