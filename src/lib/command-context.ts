// Path: src/lib/command-context.ts

/**
 * Helpers for context-aware command registration.
 *
 * In v4.0, dual-purpose command groups are registered twice:
 *   - At top level (tenant context) — `--tenant` option is omitted; the active
 *     user's JWT tenant is always used.
 *   - Under `znvault superadmin <group>` (superadmin context) — `--tenant` is
 *     accepted to target cross-tenant or system resources.
 *
 * Command handlers don't need to branch: when `context === 'tenant'`, the
 * `--tenant` option simply isn't registered, so `options.tenant` is always
 * `undefined` and existing client routing falls through to the tenant scope.
 */

import type { Command } from 'commander';

export type CommandContext = 'tenant' | 'superadmin';

export interface RegisterOptions {
  context?: CommandContext;
}

/**
 * Add a `--tenant <id>` option to a command only if running in superadmin
 * context. In tenant context this is a no-op.
 *
 * @param cmd The Commander command to extend.
 * @param ctx The active command context.
 * @param description Override description (defaults to "Tenant ID (superadmin only)").
 * @param shortFlag Set to `true` to register as `-t, --tenant <id>` instead of just `--tenant <id>`.
 */
export function addTenantOption(
  cmd: Command,
  ctx: CommandContext,
  description = 'Tenant ID (superadmin cross-tenant)',
  shortFlag = false
): Command {
  if (ctx === 'superadmin') {
    const flags = shortFlag ? '-t, --tenant <id>' : '--tenant <id>';
    return cmd.option(flags, description);
  }
  return cmd;
}

/**
 * Resolve the registration context from optional opts, defaulting to 'tenant'.
 */
export function resolveContext(opts?: RegisterOptions): CommandContext {
  return opts?.context ?? 'tenant';
}

// Module-level current registration context.
//
// Used by modularized command groups whose sub-files (e.g.
// `src/commands/apikey/list.ts`) register commands without receiving an
// explicit `ctx` parameter. The parent `registerXxxCommands(parent, opts)`
// sets the context with `withRegisterContext(ctx, () => { ... })` for the
// duration of the registration block.
let _currentContext: CommandContext = 'tenant';

/**
 * Run a registration function with the given context active. The previous
 * context is restored when `fn` returns.
 */
export function withRegisterContext(ctx: CommandContext, fn: () => void): void {
  const previous = _currentContext;
  _currentContext = ctx;
  try {
    fn();
  } finally {
    _currentContext = previous;
  }
}

/**
 * Get the active registration context. Sub-files use this to decide whether
 * to add a `--tenant` option.
 */
export function getRegisterContext(): CommandContext {
  return _currentContext;
}

export function isSuperadminContext(): boolean {
  return _currentContext === 'superadmin';
}

/**
 * Walk up a Commander Command's parent chain to detect whether the
 * currently-invoked command lives under the `superadmin` namespace. This
 * is the runtime equivalent of `isSuperadminContext()` (which only returns
 * the registration-time value).
 *
 * Handlers receive `this: Command` or `cmd: Command` from Commander; pass
 * that in (or `this.parent` from an action callback) and we'll detect by
 * inspecting the chain of `.name()` values.
 */
interface CommandWithChain {
  name(): string;
  parent: CommandWithChain | null;
}

export function isInvokedUnderSuperadmin(cmd: CommandWithChain | null | undefined): boolean {
  let node: CommandWithChain | null | undefined = cmd;
  while (node) {
    if (node.name() === 'superadmin') return true;
    node = node.parent;
  }
  return false;
}

/**
 * Patch Commander's `Command.prototype.option` once so calls of the form
 *   `.option('--tenant <id>', '...')` or `.option('-t, --tenant <id>', '...')`
 * become no-ops in tenant context. This lets us leave existing option chains
 * untouched in modularized sub-files (where breaking the chain would require
 * pervasive edits) while still enforcing the v4 rule that `--tenant` only
 * exists under `znvault superadmin <...>`.
 *
 * Idempotent: safe to call multiple times.
 */
let _tenantPatchApplied = false;

interface CommandLike {
  option(flags: string, description?: string, ...rest: unknown[]): CommandLike;
}

export function applyTenantContextPatch(commandPrototype: CommandLike): void {
  if (_tenantPatchApplied) return;
  _tenantPatchApplied = true;
  const original = commandPrototype.option;
  commandPrototype.option = function patchedOption(
    this: CommandLike,
    flags: string,
    description?: string,
    ...rest: unknown[]
  ): CommandLike {
    if (
      _currentContext === 'tenant' &&
      /(^|\s|,)--tenant\b/.test(flags)
    ) {
      // Swallow the call in tenant context; return self for chain continuity.
      return this;
    }
    return original.call(this, flags, description, ...rest) as CommandLike;
  };
}
