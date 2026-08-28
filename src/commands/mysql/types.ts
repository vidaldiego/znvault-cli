// src/commands/mysql/types.ts

/**
 * Types and constants for the `znvault mysql` command group.
 */

/** Default lease TTL in seconds (spec F12 — may be capped by role maxTtl). */
export const DEFAULT_TTL_SECONDS = 600;

/** Options shared by exec and connect. */
export interface MysqlExecOptions {
  /** Dynamic-secrets role name or ID to use for credential generation. */
  role?: string;
  /** Requested lease TTL in seconds (string from Commander, parsed to int). */
  ttl?: string;
  /** Database/schema to select as the default (overrides the credential's database). */
  database?: string;
}

/** Options specific to `mysql exec`. */
export interface MysqlExecCmdOptions extends MysqlExecOptions {
  /** SQL files to concatenate and feed to mysql via stdin (repeatable). */
  file: string[];
  /** Inline SQL string to feed to mysql via stdin. */
  sql?: string;
}

/** Options for `mysql alias add`. */
export interface MysqlAliasAddOptions {
  /** Connection name or ID to bind to the alias. */
  connection: string;
  /** Role name or ID to bind to the alias. */
  role: string;
}

/** Options for the one-shot Recovery Fence v1 consumer. */
export interface MysqlExecPermitOptions {
  /** PostgreSQL-authoritative epoch copied from the issued permit. */
  fenceEpoch: string;
  /** SQL files to concatenate and feed over stdin. No inline SQL option exists. */
  file: string[];
}
