// Path: src/lib/banner-policy.ts

/**
 * Decides whether the per-command profile/version banner may be printed.
 *
 * The banner goes to stdout. Commands whose stdout is a machine channel —
 * consumed by a shell, a JSON parser or a file redirect — must not get it,
 * or the consumer reads the banner as part of the value.
 */

/** The bits of the Commander action command the policy looks at. */
export interface BannerContext {
  /** Name of the command being executed (e.g. `decrypt`). */
  name: string;
  /** Name of its parent group, if any (e.g. `secret`). */
  parent: string | undefined;
  /** Parsed options of the command being executed. */
  opts: Record<string, unknown>;
}

/**
 * True when the profile indicator must be suppressed for this invocation.
 *
 * Cases:
 * - any command run with `--json`: stdout is one JSON document (`| jq`).
 * - `completion` (and its subcommands): stdout is evaluated by the shell.
 * - `ssh forward --print-port`: stdout carries a JSON contract line read by the
 *   deploy tunnel manager.
 * - `secret decrypt --raw` / `--field`: stdout is the bare secret value, meant
 *   for `$(...)` capture or `> file` redirection.
 */
export function shouldSkipProfileIndicator(ctx: BannerContext): boolean {
  if (ctx.opts.json === true) return true;

  if (ctx.name === 'completion' || ctx.parent === 'completion') return true;

  if (ctx.name === 'forward' && ctx.parent === 'ssh' && ctx.opts.printPort === true) return true;

  if (
    ctx.name === 'decrypt' &&
    ctx.parent === 'secret' &&
    (ctx.opts.raw === true || ctx.opts.field !== undefined)
  ) {
    return true;
  }

  return false;
}
