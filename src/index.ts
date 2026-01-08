#!/usr/bin/env node

import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerHealthCommands } from './commands/health.js';
import { registerClusterCommands } from './commands/cluster.js';
import { registerTenantCommands } from './commands/tenant.js';
import { registerUserCommands } from './commands/user.js';
import { registerSuperadminCommands } from './commands/superadmin.js';
import { registerLockdownCommands } from './commands/lockdown.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerEmergencyCommands } from './commands/emergency.js';
import { registerCertCommands } from './commands/cert.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerUpdateCommands } from './commands/update.js';
import { registerApiKeyCommands } from './commands/apikey.js';
import { registerPolicyCommands } from './commands/policy.js';
import { registerPermissionsCommands } from './commands/permissions.js';
import { registerSecretCommands } from './commands/secret.js';
import { registerKmsCommands } from './commands/kms.js';
import { registerRoleCommands } from './commands/role.js';
import { registerBackupCommands } from './commands/backup/index.js';
import { registerNotificationCommands } from './commands/notification.js';
import { registerTuiCommands } from './commands/tui.js';
import { registerSelfUpdateCommands } from './commands/self-update.js';
import { registerAdvisorCommands } from './commands/advisor.js';
import { registerCompletionCommands } from './commands/completion.js';
import { registerUnsealCommands } from './commands/unseal.js';
import { registerDeviceCommands } from './commands/device.js';
import { registerCryptoCommands } from './commands/crypto.js';
import { client } from './lib/client.js';
import { setRuntimeProfile, getActiveProfileName, getConfig } from './lib/config.js';
import { cliBanner, helpHint } from './lib/visual.js';
import { runBackgroundUpdateCheck } from './lib/cli-update.js';
import { setOutputMode } from './lib/output-mode.js';
import { profileIndicator } from './lib/output.js';
import { configureContextHelp } from './lib/context-help.js';
import { getVersion } from './lib/version.js';

interface GlobalOptions {
  url?: string;
  insecure?: boolean;
  profile?: string;
  plain?: boolean;
}

const program = new Command();

program
  .name('znvault')
  .description('ZN-Vault Administration CLI')
  .version(getVersion())
  .option('--url <url>', 'Vault server URL')
  .option('--insecure', 'Skip TLS certificate verification')
  .option('--profile <name>', 'Use a specific configuration profile')
  .option('--plain', 'Use plain text output (no colors or TUI)')
  .hook('preAction', (thisCommand, actionCommand) => {
    // Apply global options
    const opts = thisCommand.opts<GlobalOptions>();

    // Set output mode first (before any output)
    if (opts.plain) {
      setOutputMode('plain');
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

// Register all command groups
registerAuthCommands(program);
registerHealthCommands(program);
registerClusterCommands(program);
registerTenantCommands(program);
registerUserCommands(program);
registerSuperadminCommands(program);
registerLockdownCommands(program);
registerAuditCommands(program);
registerEmergencyCommands(program);
registerCertCommands(program);
registerAgentCommands(program);
registerUpdateCommands(program);
registerApiKeyCommands(program);
registerPolicyCommands(program);
registerPermissionsCommands(program);
registerSecretCommands(program);
registerKmsCommands(program);
registerRoleCommands(program);
registerBackupCommands(program);
registerNotificationCommands(program);
registerTuiCommands(program);
registerSelfUpdateCommands(program);
registerAdvisorCommands(program);
registerCompletionCommands(program);
registerUnsealCommands(program);
registerDeviceCommands(program);
registerCryptoCommands(program);

// Configure context-aware help (hides superadmin-only commands for regular users)
configureContextHelp(program);

// Run background update check (non-blocking)
runBackgroundUpdateCheck();

// Show banner when no command is provided
if (process.argv.length === 2) {
  console.log(cliBanner(getVersion()));
  console.log(helpHint());
  process.exit(0);
}

// Parse and execute
program.parse();
