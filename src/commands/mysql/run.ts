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
 *     BEFORE it exec's mysql and reads --defaults-file, so unlinking after
 *     spawn could win the race and crash mysql with
 *     "Failed to open required defaults file".
 *   - `--defaults-file=/dev/fd/<fd>` is ALWAYS the first argument (clients
 *     reject it in any other position). A preflight capability probe adds
 *     `--no-login-paths` for Oracle MySQL; MariaDB omits that unsupported flag.
 *     This is load-bearing: `--defaults-extra-file` would still read ambient
 *     option files afterwards, allowing ~/.my.cnf to override the leased
 *     host/user/password. Oracle's `--no-login-paths` also excludes
 *     .mylogin.cnf; MariaDB has no login-path facility.
 *   - Non-interactive exec always adds `--binary-mode`. Both Oracle MySQL and
 *     MariaDB then treat `\\!`/`system` as SQL input instead of executing local
 *     shell commands, while retaining DELIMITER support.
 *   - The child INHERITS the fd at the SAME number N, so `/dev/fd/N` resolves to
 *     the same inode inside the child (see buildChildStdio).
 *   - The mysql child receives a minimal, non-secret environment allowlist.
 *     Vault authentication variables and unrelated process secrets are never
 *     inherited. `MYSQL_HISTFILE=/dev/null` prevents SQL history persistence
 *     (spec F4).
 *   - No --host / --port flags are added; connection coordinates come from the
 *     cnf written by B2 (spec F2 — no client-side override). Caller passthrough
 *     is restricted to a fixed allowlist of argument-free presentation flags.
 *     This prevents current and future mysql options from overriding the
 *     target, credentials, input fence or printing the defaults file.
 *   - This module never re-opens the cnf path itself; mysql reads it via the
 *     inherited fd. The parent's own copy of the fd is released by cleanup()
 *     once the child has exited (spec F3 hygiene).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';

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
// Passthrough flag allowlist (spec F2 — no client-side connection override)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed, argument-free mysql options that cannot select a target/credential,
 * execute alternate input, run local commands, write files, or print defaults.
 * Unknown options are rejected even when they appear harmless: mysql/mariadb's
 * my_getopt modifiers and abbreviations are extensible and denylisting them has
 * repeatedly proven unsafe.
 */
const ALLOWED_PASSTHROUGH_LONG_FLAGS: ReadonlySet<string> = new Set([
  '--auto-rehash',
  '--auto-vertical-output',
  '--batch',
  '--binary-as-hex',
  '--column-names',
  '--column-type-info',
  '--comments',
  '--compress',
  '--force',
  '--html',
  '--ignore-spaces',
  '--line-numbers',
  '--no-auto-rehash',
  '--one-database',
  '--quick',
  '--raw',
  '--reconnect',
  '--safe-updates',
  '--show-warnings',
  '--silent',
  '--skip-column-names',
  '--skip-line-numbers',
  '--table',
  '--unbuffered',
  '--vertical',
  '--verbose',
  '--wait',
  '--xml',
]);

/** Argument-free short equivalents of the allowed long flags above. */
const ALLOWED_PASSTHROUGH_SHORT_FLAGS: ReadonlySet<string> = new Set([
  'A', 'B', 'b', 'C', 'c', 'E', 'f', 'H', 'i', 'L', 'N', 'n',
  'o', 'q', 'r', 's', 't', 'v', 'w', 'X',
]);

function isAllowedPassthroughToken(token: string): boolean {
  if (token.startsWith('--')) {
    // Every allowlisted long flag is argument-free. Reject = forms even for an
    // allowed head so a boolean value cannot invert or reinterpret it.
    return !token.includes('=') && ALLOWED_PASSTHROUGH_LONG_FLAGS.has(token);
  }
  if (!/^-[^-][A-Za-z]*$/.test(token)) return false;
  for (let index = 1; index < token.length; index++) {
    if (!ALLOWED_PASSTHROUGH_SHORT_FLAGS.has(token[index])) return false;
  }
  return true;
}

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
  '--no-login-paths',
  '--no-defaults',
  // Alternate target/user selectors and transports.
  '--user',
  '-u',
  '--socket',
  '-S',
  '--protocol',
  '--dns-srv-name',
  '--database',
  '-D',
  // Password — must come from the leased cnf only, never from argv.
  '--password',
  '-p',
]);

/**
 * Flags which could disable or reinterpret the non-interactive input fence.
 * `--binary-mode` is server-selected by runMysql for exec mode; callers may
 * neither negate it nor re-enable client commands / supply alternate argv SQL.
 */
const FORBIDDEN_INPUT_CONTROL_FLAGS: ReadonlySet<string> = new Set([
  '--binary-mode',
  '--commands',
  '--named-commands',
  '-G',
  '--execute',
  '-e',
  '--init-command',
  '--init-command-add',
]);

/** Meta options that can expose credentials read from the inherited cnf. */
const FORBIDDEN_SECRET_OUTPUT_FLAGS: ReadonlySet<string> = new Set([
  '--print-defaults',
]);

const MYSQL_LONG_OPTION_MODIFIERS = [
  'autoset',
  'loose',
  'enable',
  'disable',
  'skip',
  'maximum',
] as const;
const MAX_LONG_OPTION_MODIFIER_DEPTH = 8;

function canonicalLongFlag(flag: string): string {
  // my_getopt accepts `_` as `-` in long options, so the filter must do the
  // same or `--defaults_file`, `--login_path`, etc. bypass their dashed forms.
  let canonical = flag.replaceAll('_', '-');

  // my_getopt composes these modifiers and accepts abbreviations for every
  // segment. For example, all of these can negate our earlier --binary-mode:
  //   --enable-skip-binary-mode
  //   --loose-enable-skip-binary-mode
  //   --loo-ena-ski-bin
  //   --loose-maximum-skip-binary-mode
  // MariaDB additionally composes --autoset-*; Oracle rejects it, but the CLI
  // supports both families and therefore enforces the union fail-closed.
  // Strip the chain iteratively so the final security-sensitive option is
  // always checked. Bound the loop and fail closed instead of allowing an
  // attacker-controlled modifier chain to escape canonicalisation.
  for (let depth = 0; canonical.startsWith('--'); depth++) {
    const body = canonical.slice(2);
    const separator = body.indexOf('-');
    if (separator <= 0) break;
    const segment = body.slice(0, separator);
    const modifier = MYSQL_LONG_OPTION_MODIFIERS.find(candidate =>
      candidate.startsWith(segment),
    );
    if (modifier === undefined) break;
    if (depth >= MAX_LONG_OPTION_MODIFIER_DEPTH) {
      throw new Error(
        `Passthrough flag '${flag}' is not allowed — mysql option modifier ` +
        'chain exceeds the safe canonicalisation limit.',
      );
    }
    canonical = `--${body.slice(separator + 1)}`;
  }
  return canonical;
}

/**
 * mysql accepts unambiguous long-option abbreviations (`--hos` for `--host`).
 * Reject both the full forbidden spelling and every prefix mysql could resolve
 * to it. Longer unrelated options such as `--hostgroup` remain unaffected.
 */
function matchesForbiddenLongFlag(
  flag: string,
  forbidden: ReadonlySet<string>,
): boolean {
  if (!flag.startsWith('--') || flag.length <= 2) return false;
  for (const candidate of forbidden) {
    if (candidate.startsWith('--') && candidate.startsWith(flag)) return true;
  }
  return false;
}

/**
 * Apply the forbidden-option matcher to every segment suffix of a long option.
 *
 * This is the fail-closed backstop for current or future my_getopt modifiers:
 * even if a client learns an unknown `--foo-` wrapper, `--foo-bin` exposes the
 * `--bin` suffix and `--foo-skip-binary-mode` exposes `--binary-mode`. The
 * known modifier canonicaliser remains useful for precise diagnostics and its
 * explicit depth bound, but security does not depend on our modifier list being
 * eternally complete.
 */
function hasForbiddenLongFlagSuffix(
  flag: string,
  forbidden: ReadonlySet<string>,
): boolean {
  const normalized = flag.replaceAll('_', '-');
  if (!normalized.startsWith('--')) return false;
  const segments = normalized.slice(2).split('-').filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    const suffix = `--${segments.slice(index).join('-')}`;
    if (matchesForbiddenLongFlag(suffix, forbidden)) return true;
  }
  return false;
}

const FORBIDDEN_CONNECTION_SHORT_FLAGS: ReadonlySet<string> = new Set([
  'h', // host
  'P', // port
  'u', // user
  'S', // socket
  'D', // database
  'p', // password
]);

const FORBIDDEN_INPUT_SHORT_FLAGS: ReadonlySet<string> = new Set([
  'e', // execute
  'G', // named-commands
]);

/**
 * Find a forbidden option anywhere in a mysql short-option cluster.
 *
 * mysql accepts clusters and attached arguments, so looking only at token[1]
 * is unsafe: `-vh127.0.0.1`, `-vP3307`, `-vuother` and `-vppassword`
 * all place a security-sensitive option after an innocuous `-v`. All currently
 * supported innocuous mysql short options are argument-less; every short
 * option that can select a target, credential or alternate SQL input is in one
 * of the sets above. Scanning the complete token therefore handles both
 * clusters and attached arguments without changing benign clusters such as
 * `-vvv`, `-BNrs` or `-fvt`.
 */
function findForbiddenShortFlag(token: string): {
  flag: string;
  kind: 'connection' | 'input';
} | undefined {
  if (!/^-[^-]/.test(token)) return undefined;
  for (const letter of token.slice(1)) {
    if (FORBIDDEN_CONNECTION_SHORT_FLAGS.has(letter)) {
      return {flag: `-${letter}`, kind: 'connection'};
    }
    if (FORBIDDEN_INPUT_SHORT_FLAGS.has(letter)) {
      return {flag: `-${letter}`, kind: 'input'};
    }
  }
  return undefined;
}

/**
 * Accept only the fixed allowlist of argument-free presentation flags.
 * Forbidden-option recognition below exists for actionable diagnostics; the
 * final generic rejection is the security boundary for unknown future flags.
 *
 * Recognised forms for a forbidden flag `--host`:
 *   - exact:   `--host`        (its value is the next token)
 *   - inline:  `--host=value`
 *   - short:   `-h`            (value is next token)  / `-P`, `-p`
 *
 * @throws Error naming the first non-allowlisted token.
 */
export function assertPassthroughAllowed(passthrough: readonly string[]): void {
  for (const token of passthrough) {
    if (isAllowedPassthroughToken(token)) continue;

    // Normalise an inline `--flag=value` to its flag head for the lookup.
    const eqIdx = token.indexOf('=');
    const flag = eqIdx === -1 ? token : token.slice(0, eqIdx);
    const canonicalFlag = canonicalLongFlag(flag);
    const forbiddenShort = findForbiddenShortFlag(flag);

    if (
      matchesForbiddenLongFlag(canonicalFlag, FORBIDDEN_SECRET_OUTPUT_FLAGS)
      || hasForbiddenLongFlagSuffix(flag, FORBIDDEN_SECRET_OUTPUT_FLAGS)
    ) {
      throw new Error(
        `Passthrough flag '${flag}' is not allowed — credentials from the ` +
        'leased defaults file must never be printed.',
      );
    }
    if (
      matchesForbiddenLongFlag(canonicalFlag, FORBIDDEN_PASSTHROUGH_FLAGS)
      || hasForbiddenLongFlagSuffix(flag, FORBIDDEN_PASSTHROUGH_FLAGS)
      || forbiddenShort?.kind === 'connection'
    ) {
      throw new Error(
        `Passthrough flag '${flag}' is not allowed` +
        `${forbiddenShort === undefined ? '' : ` (contains ${forbiddenShort.flag})`} — ` +
        'host/port come from the ' +
        `leased connection and cannot be overridden (see F2).`,
      );
    }
    if (
      matchesForbiddenLongFlag(canonicalFlag, FORBIDDEN_INPUT_CONTROL_FLAGS)
      || hasForbiddenLongFlagSuffix(flag, FORBIDDEN_INPUT_CONTROL_FLAGS)
      || forbiddenShort?.kind === 'input'
    ) {
      throw new Error(
        `Passthrough flag '${flag}' is not allowed` +
        `${forbiddenShort === undefined ? '' : ` (contains ${forbiddenShort.flag})`} — ` +
        'non-interactive SQL must ' +
        'remain fenced by server-selected --binary-mode.',
      );
    }
    throw new Error(
      `Passthrough token '${token}' is not allowed — only fixed, ` +
      'argument-free mysql presentation flags may be passed through.',
    );
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
   * Value for `--defaults-file`. This is the `/dev/fd/<fd>` path returned
   * by createMyCnf (B2) — mysql re-opens the inherited fd through it.
   */
  fdPath: string;
  /** Optional default schema to select (positional arg — spec F8). */
  database?: string;
  /** Allowlisted, argument-free mysql presentation flags. */
  passthrough?: string[];
  /**
   * Capability discovered from the selected client. Oracle MySQL needs
   * --no-login-paths; MariaDB has no login-path feature and rejects the flag.
   */
  supportsNoLoginPaths?: boolean;
  /** Force non-interactive client-command isolation for piped SQL. */
  binaryMode?: boolean;
}

/**
 * Validate the optional positional schema before it reaches mysql argv.
 *
 * MySQL identifiers can be broader when quoted inside SQL, but the CLI schema
 * selector is deliberately a conservative ASCII contract. This prevents a
 * value beginning with `-` from being interpreted as a client option and keeps
 * control characters or shell-like path material out of process arguments.
 */
export function assertSafeMysqlDatabase(database: string | undefined): void {
  if (database === undefined) return;
  if (!/^[A-Za-z0-9_$][A-Za-z0-9_$.-]{0,63}$/.test(database)) {
    throw new Error(
      'Invalid MySQL database/schema: expected 1-64 ASCII identifier ' +
      'characters, beginning with a letter, digit, underscore, or dollar sign.',
    );
  }
}

export interface MysqlClientCapabilities {
  binary: string;
  family: 'mysql' | 'mariadb';
  supportsNoLoginPaths: boolean;
  supportsBinaryMode: boolean;
}

export function assertMysqlExecCapabilities(
  capabilities: MysqlClientCapabilities,
): void {
  if (!capabilities.supportsBinaryMode) {
    throw new Error(
      'mysql client cannot disable local commands for piped SQL; install a supported MySQL or MariaDB client',
    );
  }
}

const capabilityCache = new Map<string, MysqlClientCapabilities>();

function buildMysqlChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {MYSQL_HISTFILE: '/dev/null'};
  const exactAllowed = [
    'PATH',
    'TERM',
    'TZ',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LC_MESSAGES',
    'LC_COLLATE',
    'LC_NUMERIC',
    'LC_TIME',
    'LC_MONETARY',
    'LC_ADDRESS',
    'LC_IDENTIFICATION',
    'LC_MEASUREMENT',
    'LC_NAME',
    'LC_PAPER',
    'LC_TELEPHONE',
  ] as const;
  for (const name of exactAllowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Probe option-file isolation before a lease/permit is consumed.
 *
 * Oracle MySQL clients expose --no-login-paths and require it to exclude
 * .mylogin.cnf. MariaDB clients do not implement login paths and reject that
 * flag, so their exclusive --defaults-file is sufficient. Unknown clients
 * without the Oracle flag fail closed.
 */
export function inspectMysqlClient(binary = assertMysqlOnPath()): MysqlClientCapabilities {
  const cached = capabilityCache.get(binary);
  if (cached !== undefined) return cached;

  const result = spawnSync(binary, ['--no-defaults', '--help'], {
    encoding: 'utf8',
    env: buildMysqlChildEnv(),
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error('Unable to inspect mysql client capabilities safely');
  }
  const help = result.stdout + '\n' + result.stderr;
  if (!/(?:^|\s)--defaults-file(?:[=\s]|$)/m.test(help)) {
    throw new Error('mysql client does not support an exclusive --defaults-file');
  }
  const supportsNoLoginPaths = /(?:^|\s)--no-login-paths(?:[=\s]|$)/m.test(help);
  const supportsBinaryMode = /(?:^|\s)--binary-mode(?:[=\s]|$)/m.test(help);
  const family = /mariadb/i.test(help) ? 'mariadb' : 'mysql';
  if (!supportsNoLoginPaths && family !== 'mariadb') {
    throw new Error(
      'Oracle mysql client cannot disable login paths; install a supported MySQL or MariaDB client',
    );
  }
  const capabilities: MysqlClientCapabilities = {
    binary,
    family,
    supportsNoLoginPaths,
    supportsBinaryMode,
  };
  capabilityCache.set(binary, capabilities);
  return capabilities;
}

/**
 * Build the mysql argv and child environment.
 *
 * This is a PURE function — no spawning, no file I/O, no side effects.
 * Export it so tests can assert security-critical argv/env invariants
 * without spawning real mysql.
 *
 * Security invariants:
 *   - `--defaults-file=<fdPath>` is args[0]. Oracle MySQL then receives
 *     `--no-login-paths`; MariaDB omits the unsupported flag after probing.
 *   - Exec invocations force `--binary-mode` before the positional schema.
 *   - No --user / -u / --password / -p / MYSQL_PWD in args or env.
 *   - No --host / --port / -h / -P flags (connection coords from cnf).
 *   - Only fixed, argument-free passthrough flags are accepted (spec F2).
 *   - The child environment is a non-secret allowlist; Vault credentials and
 *     ambient MySQL selectors are never inherited.
 *   - MYSQL_HISTFILE=/dev/null overrides any pre-existing value.
 *
 * @throws If `passthrough` contains a token outside the fixed safe allowlist.
 */
export function buildMysqlInvocation(opts: BuildMysqlInvocationOpts): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const {
    fdPath,
    database,
    passthrough = [],
    supportsNoLoginPaths = true,
    binaryMode = false,
  } = opts;

  assertSafeMysqlDatabase(database);
  // F2: reject host/port/defaults/password overrides BEFORE they reach argv.
  assertPassthroughAllowed(passthrough);

  // --defaults-file MUST be first (mysql enforces this). Unlike
  // --defaults-extra-file, it excludes ~/.my.cnf and the other ordinary option
  // files. MySQL still reads .mylogin.cnf unless --no-login-paths is present.
  const args: string[] = [`--defaults-file=${fdPath}`];
  if (supportsNoLoginPaths) args.push('--no-login-paths');
  if (binaryMode) args.push('--binary-mode');

  // Validated presentation flags remain options and therefore precede the
  // explicit option terminator.
  args.push(...passthrough);

  // Add a second defence against option injection: even a future validator
  // regression cannot turn the positional schema into --print-defaults, -e,
  // --host, etc. Both supported clients accept `--` before the database.
  if (database !== undefined) {
    args.push('--', database);
  }

  // Child env: explicit non-secret allowlist. Copying process.env here would
  // leak the consumer's ZNVAULT_API_KEY/ZNVAULT_PASSWORD (and arbitrary CI
  // secrets) into the external mysql process. Locale/terminal variables are
  // sufficient for deterministic client behaviour; the binary path is already
  // resolved before spawn. MYSQL_HISTFILE is fixed, never caller-controlled.
  const env = buildMysqlChildEnv();

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
 * `--defaults-file=/dev/fd/<fd>` resolve correctly in the child: the
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
   * --defaults-file. This module never re-opens it; mysql reads the
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
  /**
   * (exec mode) Exact already-validated bytes to feed as stdin. Recovery
   * permits use this so the file is validated before the one-shot consume and
   * cannot change between validation and mysql execution.
   */
  input?: Buffer;
  /** Extra arguments appended verbatim to the mysql argv. */
  passthrough?: string[];
}

/**
 * Spawn the system `mysql` client and wait for it to exit.
 *
 * - Resolves with the child's numeric exit code (caller/CI relies on non-zero).
 * - The cnf fd (`opts.fd`) is inherited by the child at the SAME number so
 *   `--defaults-file=/dev/fd/<fd>` resolves in the child (spec F1). The
 *   directory entry was already unlinked in createMyCnf — there is NOTHING to
 *   unlink here, and NO post-spawn unlink race.
 * - 'connect' mode: stdin/stdout/stderr are inherited (interactive terminal);
 *   the cnf fd is additionally inherited at index `fd`.
 * - 'exec' mode: stdin (index 0) is wired as:
 *     1. input (exact Buffer) → stdin pipe
 *     2. files (concatenated, in order) → stdin pipe
 *     3. sql (string) → stdin pipe
 *     4. parent stdin (if not a TTY) → piped through (inherit)
 *     5. parent stdin is a TTY and no source was provided → Error
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
  // Fail closed before even resolving/probing the local client. This ordering
  // is security-relevant for recovery permits: an invalid passthrough must be
  // rejected deterministically even when mysql is absent, and no client-side
  // capability check or spawn may happen first. buildMysqlInvocation repeats
  // the check at the final argv assembly boundary as defence in depth.
  assertPassthroughAllowed(opts.passthrough ?? []);
  assertSafeMysqlDatabase(opts.database);

  const { spawn } = await import('node:child_process');

  const mysqlBin = assertMysqlOnPath();
  const capabilities = inspectMysqlClient(mysqlBin);
  if (opts.mode === 'exec') assertMysqlExecCapabilities(capabilities);
  const { args, env } = buildMysqlInvocation({
    fdPath: opts.fdPath,
    database: opts.database,
    passthrough: opts.passthrough,
    supportsNoLoginPaths: capabilities.supportsNoLoginPaths,
    binaryMode: opts.mode === 'exec',
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

  if (opts.input !== undefined) {
    const input = opts.input;
    const stdio = buildChildStdio(opts.fd, 'pipe');
    const child = spawn(mysqlBin, args, { stdio, env });
    return new Promise<number>((resolve, reject) => {
      child.on('error', (err) => { reject(err); });
      child.on('close', (code) => { resolve(code ?? 1); });
      (child.stdin as NodeJS.WritableStream).end(input);
    });
  }

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
