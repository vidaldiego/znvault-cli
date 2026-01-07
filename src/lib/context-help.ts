// Path: znvault-cli/src/lib/context-help.ts

import { Command, Option } from 'commander';
import { getAuthContext } from './auth-context.js';

// Marker suffix for superadmin-only items (stripped from display)
const SUPERADMIN_MARKER = ' [SUPERADMIN]';
const TENANT_OPTION_MARKER = ' [TENANT_OPTION]';

/**
 * Mark a command description as superadmin-only
 * The marker will be stripped from display for non-superadmins
 */
export function superadminDesc(description: string): string {
  return description + SUPERADMIN_MARKER;
}

/**
 * Mark an option as tenant-related (hidden for tenant users who don't need it)
 */
export function tenantOptionDesc(description: string): string {
  return description + TENANT_OPTION_MARKER;
}

/**
 * Check if description has superadmin marker
 */
function isSuperadminOnly(description: string): boolean {
  return description.endsWith(SUPERADMIN_MARKER);
}

/**
 * Check if description has tenant option marker
 */
function isTenantOption(description: string): boolean {
  return description.endsWith(TENANT_OPTION_MARKER);
}

/**
 * Strip markers from description
 */
function stripMarkers(description: string): string {
  return description
    .replace(SUPERADMIN_MARKER, '')
    .replace(TENANT_OPTION_MARKER, '');
}

/**
 * Configure context-aware help on a command
 * This filters out superadmin-only commands and options based on current auth context
 */
export function configureContextHelp(cmd: Command): void {
  cmd.configureHelp({
    // Filter visible subcommands
    visibleCommands: (cmd: Command) => {
      const ctx = getAuthContext();
      return cmd.commands.filter((sub) => {
        const desc = sub.description();
        // Hide superadmin commands for non-superadmins
        if (isSuperadminOnly(desc) && !ctx.isSuperadmin) {
          return false;
        }
        return true;
      });
    },

    // Filter visible options
    visibleOptions: (cmd: Command) => {
      const ctx = getAuthContext();
      return cmd.options.filter((opt) => {
        const desc = opt.description;
        // Hide superadmin options for non-superadmins
        if (isSuperadminOnly(desc) && !ctx.isSuperadmin) {
          return false;
        }
        // Hide tenant options for tenant users (they have implicit tenant)
        if (isTenantOption(desc) && ctx.tenantId && !ctx.isSuperadmin) {
          return false;
        }
        return true;
      });
    },

    // Format subcommand descriptions (strip markers)
    subcommandDescription: (cmd: Command) => {
      return stripMarkers(cmd.description());
    },

    // Format option descriptions (strip markers)
    optionDescription: (opt: Option) => {
      return stripMarkers(opt.description);
    },
  });
}

/**
 * Add a superadmin-only option to a command
 * Will be hidden from help for non-superadmins
 */
export function addSuperadminOption(
  cmd: Command,
  flags: string,
  description: string,
  defaultValue?: unknown
): Command {
  const opt = new Option(flags, superadminDesc(description));
  if (defaultValue !== undefined) {
    opt.default(defaultValue);
  }
  return cmd.addOption(opt);
}

/**
 * Add a tenant option (like --tenant <id>) that's hidden for tenant users
 */
export function addTenantOption(
  cmd: Command,
  description = 'Tenant ID (superadmin only)'
): Command {
  const opt = new Option('--tenant <id>', tenantOptionDesc(description));
  return cmd.addOption(opt);
}

/**
 * Create a superadmin-only subcommand
 */
export function createSuperadminCommand(name: string, description: string): Command {
  const cmd = new Command(name);
  cmd.description(superadminDesc(description));
  return cmd;
}
