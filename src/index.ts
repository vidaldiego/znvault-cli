#!/usr/bin/env node

import { Command } from 'commander';
import { applyTenantContextPatch } from './lib/command-context.js';
import { registerAuthCommands } from './commands/auth.js';

// Apply the global Commander patch that gates `--tenant` options by registration
// context. Must run before any command registration.
applyTenantContextPatch(Command.prototype);
import { registerHealthCommands } from './commands/health.js';
import { registerUserCommands } from './commands/user.js';
import { registerSuperadminCommands } from './commands/superadmin/index.js';
import { registerQuarantineCommands } from './commands/quarantine.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerEmergencyCommands } from './commands/emergency.js';
import { registerCertCommands } from './commands/cert.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerHostCommands } from './commands/host/index.js';
import { registerUpdateCommands } from './commands/update.js';
import { registerApiKeyCommands } from './commands/apikey.js';
import { registerPolicyCommands } from './commands/policy.js';
import { registerPermissionsCommands } from './commands/permissions.js';
import { registerSecretCommands } from './commands/secret.js';
import { registerKmsCommands } from './commands/kms/index.js';
import { registerRoleCommands } from './commands/role.js';
import { registerNotificationCommands } from './commands/notification.js';
import { registerTuiCommands } from './commands/tui.js';
import { registerSelfUpdateCommands } from './commands/self-update.js';
import { registerAdvisorCommands } from './commands/advisor.js';
import { registerCompletionCommands } from './commands/completion.js';
import { registerUnsealCommands } from './commands/unseal.js';
import { registerDeviceCommands } from './commands/device.js';
import { registerCryptoCommands } from './commands/crypto.js';
import { registerPluginCommands } from './commands/plugin/index.js';
import { registerSSOCommands } from './commands/sso/index.js';
import { registerGroupCommands } from './commands/group.js';
import { registerDynamicSecretsCommands } from './commands/dynamic-secrets.js';
import { registerSSHCommands } from './commands/ssh/index.js';
import { registerSSHCACommands } from './commands/ssh-ca.js';
import { registerKmipCommands } from './commands/kmip/index.js';
import { registerMysqlCommands } from './commands/mysql/index.js';
import { registerMigrationCommands } from './commands/migration.js';
import { client } from './lib/client.js';
import {
  setRuntimeProfile,
  listProfileNames,
  profileExists,
  getActiveProfileName,
  getConfig,
  getPlugins,
  getCredentials,
  hasApiKey,
  getStoredApiKeyInfo,
} from './lib/config.js';
import { cliBanner, helpHint, cliStatusDisplay, quickCommands, type CLIStatusInfo } from './lib/visual.js';
import { runBackgroundUpdateCheck } from './lib/cli-update.js';
import { setOutputMode, setQuietMode } from './lib/output-mode.js';
import { profileIndicator } from './lib/output.js';
import { shouldSkipProfileIndicator } from './lib/banner-policy.js';
import { configureContextHelp } from './lib/context-help.js';
import { getVersion } from './lib/version.js';
import { areCLIPluginsDisabled } from './plugins/policy.js';

interface GlobalOptions {
  url?: string;
  insecure?: boolean;
  tlsSpkiSha256?: string;
  profile?: string;
  plain?: boolean;
  quiet?: boolean;
}

/**
 * Name of the top-level command group an action belongs to — `profile` for
 * `znvault profile create`, `superadmin` for `znvault superadmin rootkey
 * verify` — or null when the action is the root command itself.
 */
function topLevelCommandName(actionCommand: Command): string | null {
  let cmd = actionCommand;
  while (cmd.parent?.parent) {
    cmd = cmd.parent;
  }
  return cmd.parent ? cmd.name() : null;
}

const program = new Command();

program
  .name('znvault')
  .description('ZnVault Administration CLI')
  // Enable positional options on the root program so that options appearing after
  // a subcommand name are parsed relative to position. Commander requires this on
  // ancestor commands for nested positional parsing to reach grandchild commands
  // (e.g. `znvault ssh connect --dry-run`), where the `ssh` parent also declares
  // its own options for the `ssh user@host` shortcut. See src/commands/ssh/index.ts.
  .enablePositionalOptions()
  .version(getVersion())
  .option('--url <url>', 'Vault server URL')
  .option('--insecure', 'Skip TLS certificate verification')
  .option('--tls-spki-sha256 <hex>', 'Require the server certificate public-key SHA-256')
  .option('--profile <name>', 'Use a specific configuration profile')
  .option('--plain', 'Use plain text output (no colors or TUI)')
  .option('-q, --quiet', 'Suppress non-essential output (spinners, info messages, banners)')
  .option('--no-plugins', 'Do not discover, import, or register configured CLI plugins')
  .hook('preAction', (thisCommand, actionCommand) => {
    // Apply global options
    const opts = thisCommand.opts<GlobalOptions>();

    // Set output mode first (before any output)
    if (opts.plain) {
      setOutputMode('plain');
    }

    // Set quiet mode (suppresses spinners, info, success, banners)
    if (opts.quiet) {
      setQuietMode(true);
    }

    // Set profile override (before any config access).
    //
    // Fail closed on a profile that does not exist. getCurrentProfile() falls
    // back to CONFIG_DEFAULTS (https://localhost:8443) for an unknown name so
    // a fresh install works out of the box; applied to an explicit
    // `--profile <name>` that default silently retargets the command at the
    // operator's own machine. A runbook step like
    // `znvault --profile prod superadmin rootkey verify` would then report on
    // localhost, and a verification that answers about the wrong host is worse
    // than one that refuses to answer.
    //
    // The `profile` command group is exempt so profile management itself is
    // never locked out by its own guard.
    if (opts.profile) {
      const commandGroup = topLevelCommandName(actionCommand);
      if (commandGroup !== 'profile' && !profileExists(opts.profile)) {
        const known = listProfileNames();
        throw new Error(
          `unknown profile '${opts.profile}'. ` +
            (known.length > 0
              ? `Configured profiles: ${known.join(', ')}.`
              : 'No profiles are configured.') +
            " Create one with `znvault profile create <name> --vault-url <url>`, or run without --profile to use the active profile."
        );
      }
      setRuntimeProfile(opts.profile);
    }

    // Apply URL/insecure overrides
    if (opts.insecure && opts.tlsSpkiSha256 !== undefined) {
      throw new Error('--insecure cannot be combined with --tls-spki-sha256');
    }
    if (
      opts.url !== undefined ||
      opts.insecure !== undefined ||
      opts.tlsSpkiSha256 !== undefined
    ) {
      client.configure(opts.url, opts.insecure, opts.tlsSpkiSha256);
    }

    // Skip the profile indicator when stdout is a machine channel (`--json`,
    // shell completion, `ssh forward --print-port`, `secret decrypt --raw/--field`).
    // The policy lives in lib/banner-policy.ts so it can be unit-tested.
    if (
      shouldSkipProfileIndicator({
        name: actionCommand.name(),
        parent: actionCommand.parent?.name(),
        opts: actionCommand.opts(),
      })
    ) {
      return;
    }

    // Show current profile indicator
    const config = getConfig();
    profileIndicator(getActiveProfileName(), config.url);
  });

// Register all top-level command groups (tenant context by default).
//
// In v4, the following groups moved entirely under `znvault superadmin <...>`
// and are no longer registered at the top level:
//   - tenant, cluster, lockdown, lmk, backup (pure-superadmin)
//   - superadmin account management → `superadmin accounts <...>`
//
// Dual-purpose groups (user, audit, quarantine, advisor, agent, apikey, host,
// kms, policy, role, sso, ssh, group) are registered here in tenant context
// (no --tenant flag) AND again under the superadmin namespace with
// `context: 'superadmin'` (--tenant accepted).
registerAuthCommands(program);
registerHealthCommands(program);
registerUserCommands(program);
registerQuarantineCommands(program);
registerAuditCommands(program);
registerEmergencyCommands(program);
registerCertCommands(program);
registerAgentCommands(program);
registerHostCommands(program);
registerUpdateCommands(program);
registerApiKeyCommands(program);
registerPolicyCommands(program);
registerPermissionsCommands(program);
registerSecretCommands(program);
registerKmsCommands(program);
registerRoleCommands(program);
registerNotificationCommands(program);
registerTuiCommands(program);
registerSelfUpdateCommands(program);
registerAdvisorCommands(program);
registerCompletionCommands(program);
registerUnsealCommands(program);
registerDeviceCommands(program);
registerCryptoCommands(program);
registerPluginCommands(program);
registerSSOCommands(program);
registerGroupCommands(program);
registerDynamicSecretsCommands(program);
registerSSHCommands(program);
registerSSHCACommands(program);
registerKmipCommands(program);
registerMysqlCommands(program);
registerMigrationCommands(program);

// Superadmin namespace (must come last so all referenced groups are loaded).
registerSuperadminCommands(program);

// Configure context-aware help (hides superadmin-only commands for regular users)
configureContextHelp(program);

// Run background update check (non-blocking)
runBackgroundUpdateCheck();

/**
 * Get CLI status information for display
 */
function getCLIStatus(): CLIStatusInfo {
  const config = getConfig();
  const profile = getActiveProfileName();
  const credentials = getCredentials();
  const apiKeyInfo = getStoredApiKeyInfo();

  let authMethod: 'jwt' | 'apikey' | 'none' = 'none';
  let username: string | undefined;
  let apiKeyName: string | undefined;
  let apiKeyPrefix: string | undefined;

  if (hasApiKey()) {
    authMethod = 'apikey';
    if (apiKeyInfo) {
      apiKeyName = apiKeyInfo.name;
      apiKeyPrefix = apiKeyInfo.key.substring(0, 12) + '...';
    }
  } else if (credentials?.accessToken) {
    authMethod = 'jwt';
    // Try to extract username from JWT payload
    try {
      const payload = credentials.accessToken.split('.')[1];
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString()) as { sub?: string; username?: string };
      username = decoded.username ?? decoded.sub;
    } catch {
      username = 'authenticated';
    }
  }

  return {
    version: getVersion(),
    profile,
    vaultUrl: config.url,
    authMethod,
    username,
    apiKeyName,
    apiKeyPrefix,
  };
}

// Main async entry point
async function main(): Promise<void> {
  // Show enhanced status when no command is provided
  if (process.argv.length === 2) {
    const status = getCLIStatus();
    console.log(cliBanner(status.version));
    console.log(cliStatusDisplay(status));
    console.log(quickCommands());
    console.log(helpHint());
    process.exit(0);
  }

  // Apply quiet mode early from argv (before commander parses)
  if (process.argv.includes('--quiet') || process.argv.includes('-q')) {
    setQuietMode(true);
  }

  // This raw-argv policy check must happen before getPlugins(): configured
  // plugin modules execute during import and are outside the built-in CLI TCB.
  if (!areCLIPluginsDisabled(process.argv.slice(2))) {
    const pluginConfigs = getPlugins();
    if (pluginConfigs.length > 0) {
      try {
        const { createCLIPluginLoader } = await import('./plugins/loader.js');
        const pluginLoader = await createCLIPluginLoader(
          pluginConfigs,
          client,
          getConfig,
          getActiveProfileName
        );
        pluginLoader.registerCommands(program);
      } catch {
        // Plugin loading errors are non-fatal - warnings already printed
      }
    }
  }

  // Await asynchronous command actions so a rejected signing/transport path is
  // observed by the top-level failure boundary rather than escaping it.
  await program.parseAsync();
}

// Run main
main().catch((err: unknown) => {
  console.error('CLI error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
