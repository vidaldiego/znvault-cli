#!/usr/bin/env node

import { Command } from 'commander';
import { applyTenantContextPatch } from './lib/command-context.js';
import { registerAuthCommands } from './commands/auth.js';

// Apply the global Commander patch that gates `--tenant` options by registration
// context. Must run before any command registration.
applyTenantContextPatch(Command.prototype as unknown as Parameters<typeof applyTenantContextPatch>[0]);
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
import { client } from './lib/client.js';
import {
  setRuntimeProfile,
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
import { configureContextHelp } from './lib/context-help.js';
import { getVersion } from './lib/version.js';
import { createCLIPluginLoader } from './plugins/loader.js';

interface GlobalOptions {
  url?: string;
  insecure?: boolean;
  profile?: string;
  plain?: boolean;
  quiet?: boolean;
}

const program = new Command();

program
  .name('znvault')
  .description('ZnVault Administration CLI')
  .version(getVersion())
  .option('--url <url>', 'Vault server URL')
  .option('--insecure', 'Skip TLS certificate verification')
  .option('--profile <name>', 'Use a specific configuration profile')
  .option('--plain', 'Use plain text output (no colors or TUI)')
  .option('-q, --quiet', 'Suppress non-essential output (spinners, info messages, banners)')
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

    // Set profile override (before any config access)
    if (opts.profile) {
      setRuntimeProfile(opts.profile);
    }

    // Apply URL/insecure overrides
    if (opts.url !== undefined || opts.insecure !== undefined) {
      client.configure(opts.url, opts.insecure);
    }

    // Skip profile indicator for completion commands (output is evaluated by shell)
    const cmdPath = actionCommand.name();
    const parentName = actionCommand.parent?.name();
    if (parentName === 'completion' || cmdPath === 'completion') {
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

  // Load CLI plugins
  const pluginConfigs = getPlugins();
  if (pluginConfigs.length > 0) {
    try {
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

  // Parse and execute
  program.parse();
}

// Run main
main().catch((err) => {
  console.error('CLI error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
