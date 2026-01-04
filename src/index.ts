#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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
import { client } from './lib/client.js';
import { setRuntimeProfile } from './lib/config.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
  const possiblePaths = [
    path.join(__dirname, '../package.json'),
    path.join(__dirname, '../../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    } catch { /* continue */ }
  }
  return 'unknown';
}

const program = new Command();

program
  .name('znvault')
  .description('ZN-Vault Administration CLI')
  .version(getVersion())
  .option('--url <url>', 'Vault server URL')
  .option('--insecure', 'Skip TLS certificate verification')
  .option('-p, --profile <name>', 'Use a specific configuration profile')
  .hook('preAction', (thisCommand) => {
    // Apply global options
    const opts = thisCommand.opts();

    // Set profile override first (before any config access)
    if (opts.profile) {
      setRuntimeProfile(opts.profile);
    }

    // Apply URL/insecure overrides
    if (opts.url || opts.insecure !== undefined) {
      client.configure(opts.url, opts.insecure);
    }
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

// Parse and execute
program.parse();
