// Path: src/commands/ssh/config.ts

/**
 * SSH local configuration commands
 */

import type { Command } from 'commander';
import * as output from '../../lib/output.js';
import { getCurrentProfile, saveProfile, getActiveProfileName } from '../../lib/config.js';

export function registerConfigCommands(parent: Command): void {
  const config = parent
    .command('config')
    .description('Configure local SSH settings for this profile');

  // Show Config
  config
    .command('show')
    .description('Show current SSH configuration')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      const sshConfig = {
        user: profile.sshUser ?? null,
        identity: profile.sshIdentity ?? null,
      };

      if (options.json) {
        output.json(sshConfig);
        return;
      }

      output.section(`SSH Config (profile: ${profileName})`);
      output.keyValue({
        'Default User': profile.sshUser ?? '(not set)',
        'Default Identity': profile.sshIdentity ?? '(auto-detect)',
      });

      if (!profile.sshUser) {
        console.log();
        output.info('Set default user: znvault ssh config set user sysadmin');
      }
    });

  // Set Config
  config
    .command('set <key> <value>')
    .description('Set SSH configuration value (user, identity)')
    .action(async (key: string, value: string) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      switch (key.toLowerCase()) {
        case 'user':
        case 'username':
          profile.sshUser = value;
          saveProfile(profileName, profile);
          output.success(`Default SSH user set to: ${value}`);
          break;

        case 'identity':
        case 'key': {
          // Resolve to absolute path
          const path = await import('path');
          const fs = await import('fs');
          const resolvedPath = path.resolve(value.replace(/^~/, process.env.HOME ?? ''));

          if (!fs.existsSync(resolvedPath)) {
            output.warn(`Warning: Identity file not found: ${resolvedPath}`);
          }

          profile.sshIdentity = resolvedPath;
          saveProfile(profileName, profile);
          output.success(`Default SSH identity set to: ${resolvedPath}`);
          break;
        }

        default:
          output.error(`Unknown config key: ${key}`);
          output.info('Valid keys: user, identity');
          process.exit(1);
      }
    });

  // Unset Config
  config
    .command('unset <key>')
    .description('Clear SSH configuration value')
    .action((key: string) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      switch (key.toLowerCase()) {
        case 'user':
        case 'username':
          delete profile.sshUser;
          saveProfile(profileName, profile);
          output.success('Default SSH user cleared');
          break;

        case 'identity':
        case 'key':
          delete profile.sshIdentity;
          saveProfile(profileName, profile);
          output.success('Default SSH identity cleared');
          break;

        default:
          output.error(`Unknown config key: ${key}`);
          output.info('Valid keys: user, identity');
          process.exit(1);
      }
    });
}
