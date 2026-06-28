// src/commands/mysql/index.ts

/**
 * Register `znvault mysql` commands: exec, connect, alias.
 *
 * Security guarantees (spec F1–F12):
 *   - assertMysqlOnPath() is called BEFORE generating a lease (fail-fast, no
 *     wasted credentials if mysql is absent — spec F1).
 *   - Password never in argv/env/stdout (broker writes 0600 my.cnf — spec F3).
 *   - host/port come from the vault server; no --host fallback (spec F2).
 *     If the server credential lacks host, runBrokered throws a clear upgrade
 *     error — surfaced here, never swallowed.
 *   - process.exit(code) propagates the mysql exit code so CI scripts can rely
 *     on non-zero exit to detect SQL failures.
 */

import type { Command } from 'commander';
import * as output from '../../lib/output.js';
import { resolveTarget } from './resolve.js';
import { runBrokered } from './broker.js';
import { assertMysqlOnPath, runMysql } from './run.js';
import { addAlias, listAliases, removeAlias } from './alias.js';
import type { MysqlExecCmdOptions, MysqlExecOptions } from './types.js';

/**
 * Collect helper for Commander repeatable options (--file <path> ... --file <path>).
 * Each invocation appends the new value to the accumulator array.
 */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Parse and validate the `--ttl <seconds>` option (M-2).
 *
 * `parseInt('abc', 10)` is `NaN`, and `NaN ?? 600` stays `NaN` — which would be
 * sent to the server as the requested TTL and produce a confusing bad request.
 * Validate locally and fail fast with a clear message BEFORE any lease is
 * generated.
 *
 * @param raw The raw `--ttl` option value, or undefined when not provided.
 * @returns The parsed positive integer, or undefined when `--ttl` is absent
 *          (so the server/role default applies).
 * @throws If `--ttl` is provided but is not a positive integer.
 */
export function parseTtlSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(
      `Invalid --ttl '${raw}': must be a positive integer number of seconds.`,
    );
  }
  return ttl;
}

/**
 * Register the `mysql` command group and all subcommands on `program`.
 */
export function registerMysqlCommands(program: Command): void {
  const mysql = program
    .command('mysql')
    // enablePositionalOptions() lets the variadic [mysqlArgs...] coexist cleanly
    // with named options — keeps '--' separator forwarding well-defined.
    .enablePositionalOptions()
    .description('Connect to MySQL databases via short-lived dynamic-secret credentials')
    .addHelpText('after', `
Examples:
  # Interactive shell (connect mode)
  znvault mysql connect my-connection

  # Execute SQL from a file
  znvault mysql exec my-connection --file schema.sql

  # Execute inline SQL
  znvault mysql exec my-connection --sql "SELECT 1"

  # Pipe SQL from stdin
  echo "SELECT version()" | znvault mysql exec my-connection

  # Use an alias (see: znvault mysql alias add)
  znvault mysql connect staging-rw

  # Save an alias for quick access
  znvault mysql alias add staging-rw --connection staging-mysql --role app-rw

  # Pass extra mysql flags after --
  znvault mysql connect my-connection -- --table
`);

  // ── exec ─────────────────────────────────────────────────────────────────────
  //
  // Using `exec <target> [mysqlArgs...]` (variadic) instead of passThroughOptions()
  // so that named options (--role, --sql, etc.) can appear AFTER the positional
  // <target> argument without being misread as excess positional args.
  //
  // With passThroughOptions(), Commander stops option-parsing at the first
  // non-option token (the target), so `exec staging-mysql --role app-rw` was
  // rejected as "too many arguments" — the target consumed the stop-point and
  // --role/--sql were treated as excess positional args.
  //
  // The variadic approach: Commander continues parsing named options across the
  // whole argv, and any unrecognised tokens (or tokens after `--`) land in the
  // mysqlArgs array instead of causing an error.  The `--` separator itself is
  // NOT included in mysqlArgs — Commander strips it automatically.
  mysql
    .command('exec <target> [mysqlArgs...]')
    .description('Execute SQL against a MySQL database via a short-lived credential')
    .option('--role <name>', 'Dynamic-secrets role name or ID')
    .option('--file <path>', 'SQL file to execute (repeatable; concatenated in order)', collect, [])
    .option('--sql <sql>', 'Inline SQL to execute')
    .option('--ttl <seconds>', `Requested lease TTL in seconds (default: 600; capped by role maxTtl)`)
    .option('--database <db>', 'Database/schema to select (overrides the credential default)')
    .action(async (target: string, mysqlArgs: string[], opts: MysqlExecCmdOptions) => {
      // mysqlArgs contains any extra tokens (e.g. post-`--` flags like --batch).
      // Commander excludes the `--` separator itself from this array.
      const passthrough: string[] = mysqlArgs;

      try {
        // Fail fast: check mysql binary before generating any lease.
        assertMysqlOnPath();

        // Validate --ttl locally before generating any lease (M-2).
        const ttlSeconds = parseTtlSeconds(opts.ttl);

        const { roleId } = await resolveTarget(target, opts.role);
        const code = await runBrokered({
          roleId,
          ttlSeconds,
          run: ({ credential, fd, fdPath }) =>
            runMysql({
              fd,
              fdPath,
              database: opts.database ?? credential.database,
              mode: 'exec',
              files: opts.file,
              sql: opts.sql,
              passthrough,
            }),
        });
        process.exit(code);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── connect ───────────────────────────────────────────────────────────────────
  // Same variadic idiom as exec — see exec comment above.
  mysql
    .command('connect <target> [mysqlArgs...]')
    .description('Open an interactive MySQL shell via a short-lived credential')
    .option('--role <name>', 'Dynamic-secrets role name or ID')
    .option('--ttl <seconds>', `Requested lease TTL in seconds (default: 600; capped by role maxTtl)`)
    .option('--database <db>', 'Database/schema to select (overrides the credential default)')
    .action(async (target: string, mysqlArgs: string[], opts: MysqlExecOptions) => {
      const passthrough: string[] = mysqlArgs;

      try {
        // Fail fast: check mysql binary before generating any lease.
        assertMysqlOnPath();

        // Validate --ttl locally before generating any lease (M-2).
        const ttlSeconds = parseTtlSeconds(opts.ttl);

        const { roleId } = await resolveTarget(target, opts.role);
        const code = await runBrokered({
          roleId,
          ttlSeconds,
          run: ({ credential, fd, fdPath }) =>
            runMysql({
              fd,
              fdPath,
              database: opts.database ?? credential.database,
              mode: 'connect',
              passthrough,
            }),
        });
        process.exit(code);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── alias ─────────────────────────────────────────────────────────────────────
  const alias = mysql
    .command('alias')
    .description('Manage MySQL connection aliases for quick access');

  alias
    .command('add <name>')
    .description('Add or overwrite a MySQL connection alias')
    .requiredOption('--connection <connection>', 'Connection name or ID to bind')
    .requiredOption('--role <role>', 'Role name or ID to bind')
    .action((name: string, opts: { connection: string; role: string }) => {
      try {
        addAlias(name, opts.connection, opts.role);
        output.success(`Alias '${name}' saved → ${opts.connection} / ${opts.role}`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  alias
    .command('list')
    .alias('ls')
    .description('List all MySQL aliases in the active profile')
    .action(() => {
      try {
        const aliases = listAliases();
        if (aliases.length === 0) {
          output.info('No aliases defined. Use: znvault mysql alias add <name> --connection <c> --role <r>');
          return;
        }
        output.table(
          ['Name', 'Connection', 'Role'],
          aliases.map(({ name, connection, role }) => [name, connection, role]),
        );
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  alias
    .command('rm <name>')
    .description('Remove a MySQL alias from the active profile')
    .action((name: string) => {
      try {
        removeAlias(name);
        output.success(`Alias '${name}' removed`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
