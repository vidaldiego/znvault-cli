import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import {
  getCredentials,
  clearCredentials,
  clearApiKey,
  setConfigValue,
  getAllConfig,
  getConfigPath,
  getActiveProfileName,
  listProfiles,
  createProfile,
  deleteProfile,
  switchProfile,
  renameProfile,
  getProfile,
  storeApiKey,
  getStoredApiKey,
} from '../lib/config.js';
import { promptUsername, promptPassword, promptTotp } from '../lib/prompts.js';
import * as output from '../lib/output.js';

// ============================================================================
// Option Interfaces
// ============================================================================

interface LoginOptions {
  username?: string;
  password?: string;
  totp?: string;
}

interface LogoutOptions {
  keepApikey?: boolean;
}

interface LoginApiKeyOptions {
  username?: string;
  password?: string;
  totp?: string;
  expires: string;
  name?: string;
  permissions?: string;
  replace?: boolean;
}

interface JsonOutputOptions {
  json?: boolean;
}

interface ConfigGetOptions {
  json?: boolean;
}

interface ProfileListOptions {
  json?: boolean;
}

interface ProfileCurrentOptions {
  json?: boolean;
}

interface ProfileCreateOptions {
  vaultUrl?: string;
  insecure?: boolean;
  copyFrom?: string;
  use?: boolean;
}

interface ProfileDeleteOptions {
  force?: boolean;
}

interface ProfileShowOptions {
  json?: boolean;
}

export function registerAuthCommands(program: Command): void {
  // Login command
  program
    .command('login')
    .description('Authenticate with the vault server')
    .option('-u, --username <username>', 'Username')
    .option('-p, --password <password>', 'Password')
    .option('-t, --totp <code>', 'TOTP code (if 2FA enabled)')
    .action(async (options: LoginOptions) => {
      try {
        const username = options.username ?? await promptUsername();
        const password = options.password ?? await promptPassword();
        // Only prompt for TOTP if not running in CI mode and credentials weren't provided via CLI
        const isNonInteractive = process.env.CI === 'true' || (options.username && options.password);
        const totp = options.totp ?? (isNonInteractive ? undefined : await promptTotp());

        const spinner = ora('Authenticating...').start();

        try {
          const response = await client.login(username, password, totp);
          spinner.succeed(`Login successful (profile: ${getActiveProfileName()})`);

          output.keyValue({
            'User ID': response.user.id,
            'Username': response.user.username,
            'Role': response.user.role,
            'Tenant': response.user.tenantId ?? 'None (superadmin)',
          });
        } catch (err) {
          spinner.fail('Login failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Logout command
  program
    .command('logout')
    .description('Clear stored credentials and API key')
    .option('--keep-apikey', 'Keep stored API key (only clear JWT credentials)')
    .action((options: LogoutOptions) => {
      clearCredentials();
      if (!options.keepApikey) {
        clearApiKey();
      }
      output.success(`Logged out successfully (profile: ${getActiveProfileName()})`);
    });

  // Login with API key creation
  program
    .command('login-apikey')
    .description('Login and create a long-lived API key for this profile')
    .option('-u, --username <username>', 'Username')
    .option('-p, --password <password>', 'Password')
    .option('-t, --totp <code>', 'TOTP code (if 2FA enabled)')
    .option('-e, --expires <days>', 'Days until API key expires (default: 365)', '365')
    .option('-n, --name <name>', 'API key name (default: znvault-cli-<profile>)')
    .option('-P, --permissions <perms>', 'Comma-separated permissions (defaults to common CLI permissions)')
    .option('--replace', 'Replace existing API key if one exists')
    .action(async (options: LoginApiKeyOptions) => {
      const profileName = getActiveProfileName();

      // Check if API key already exists
      const existingKey = getStoredApiKey();
      if (existingKey && !options.replace) {
        output.error(`Profile '${profileName}' already has an API key stored.`);
        console.log('Use --replace to create a new one, or use "znvault logout" first.');
        process.exit(1);
      }

      try {
        const username = options.username ?? await promptUsername();
        const password = options.password ?? await promptPassword();
        // Only prompt for TOTP if not running in CI mode and credentials weren't provided via CLI
        const isNonInteractive = process.env.CI === 'true' || (options.username && options.password);
        const totp = options.totp ?? (isNonInteractive ? undefined : await promptTotp());

        const spinner = ora('Authenticating...').start();

        try {
          // First login to get JWT
          await client.login(username, password, totp);
          spinner.text = 'Creating API key...';

          // Create API key
          const expiresInDays = parseInt(options.expires, 10);
          const keyName = options.name ?? `znvault-cli-${profileName}`;

          // Default permissions for CLI usage (read secrets, configs, basic operations)
          const defaultPermissions = [
            'secret:read:value',
            'secret:read:metadata',
            'secret:list:values',
            'secret:list:metadata',
            'config:read',
            'config:list',
            'certificate:read:value',
            'certificate:read:metadata',
            'certificate:list',
            'kms:encrypt',
            'kms:decrypt',
          ];

          const permissions = options.permissions
            ? options.permissions.split(',').map((p: string) => p.trim())
            : defaultPermissions;

          const result = await client.createApiKey({
            name: keyName,
            description: `CLI profile: ${profileName}`,
            expiresInDays,
            permissions,
          });

          // Store the API key in the profile
          storeApiKey(result.key);

          // Clear JWT credentials (we'll use the API key now)
          clearCredentials();

          spinner.succeed('API key created and stored');

          console.log('\n✓ Profile configured for API key authentication\n');
          output.keyValue({
            'Profile': profileName,
            'API Key Name': result.apiKey.name,
            'API Key Prefix': result.apiKey.prefix,
            'Permissions': `${result.apiKey.permissions.length} granted`,
            'Expires': new Date(result.apiKey.expires_at).toLocaleDateString(),
            'Days Until Expiry': expiresInDays,
          });

          console.log('\nYou can now use znvault commands without logging in again.');
          console.log('The API key is stored securely in your profile config.');
        } catch (err) {
          spinner.fail('Failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Whoami command
  program
    .command('whoami')
    .description('Show current authenticated user')
    .option('--json', 'Output as JSON')
    .action(async (options: JsonOutputOptions) => {
      const credentials = getCredentials();
      const storedApiKey = getStoredApiKey();
      const profileName = getActiveProfileName();

      // If we have a stored API key, try to get info from it
      if (storedApiKey) {
        try {
          const result = await client.getApiKeySelf();
          const data = {
            profile: profileName,
            authMethod: 'API Key',
            apiKeyName: result.apiKey.name,
            apiKeyPrefix: result.apiKey.prefix,
            expiresInDays: result.expiresInDays,
            expiringSoon: result.isExpiringSoon,
          };

          if (options.json) {
            output.json(data);
          } else {
            output.keyValue(data);
            if (result.isExpiringSoon) {
              console.log('\n⚠️  API key expiring soon! Run "znvault login-apikey --replace" to renew.');
            }
          }
          return;
        } catch {
          // API key might be invalid, fall through to check JWT
        }
      }

      if (!credentials) {
        output.error(`Not logged in (profile: ${profileName}). Run "znvault login" or "znvault login-apikey" first.`);
        process.exit(1);
      }

      const data = {
        profile: profileName,
        authMethod: 'JWT',
        userId: credentials.userId,
        username: credentials.username,
        role: credentials.role,
        tenantId: credentials.tenantId ?? 'None',
        tokenExpires: new Date(credentials.expiresAt).toLocaleString(),
      };

      if (options.json) {
        output.json(data);
      } else {
        output.keyValue(data);
      }
    });

  // Config command
  const configCmd = program
    .command('config')
    .description('Manage CLI configuration');

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value (url, insecure, timeout, defaultTenant)')
    .action((key: string, value: string) => {
      const validKeys = ['url', 'insecure', 'timeout', 'defaultTenant'];
      if (!validKeys.includes(key)) {
        output.error(`Invalid config key. Valid keys: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      let parsedValue: string | boolean | number = value;
      if (key === 'insecure') {
        parsedValue = value === 'true';
      } else if (key === 'timeout') {
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue)) {
          output.error('Timeout must be a number (milliseconds)');
          process.exit(1);
        }
      }

      setConfigValue(key as 'url' | 'insecure' | 'timeout', parsedValue as never);
      output.success(`Set ${key} = ${parsedValue} (profile: ${getActiveProfileName()})`);
    });

  configCmd
    .command('get [key]')
    .description('Get configuration value(s)')
    .option('--json', 'Output as JSON')
    .action((key: string | undefined, options: ConfigGetOptions) => {
      const config = getAllConfig();

      if (key) {
        if (!(key in config)) {
          output.error(`Unknown config key: ${key}`);
          process.exit(1);
        }
        console.log(config[key]);
      } else {
        if (options.json) {
          output.json(config);
        } else {
          output.keyValue(config);
        }
      }
    });

  configCmd
    .command('path')
    .description('Show config file path')
    .action(() => {
      console.log(getConfigPath());
    });

  // ============================================================================
  // Profile Management Commands
  // ============================================================================

  const profileCmd = program
    .command('profile')
    .description('Manage configuration profiles');

  // List profiles
  profileCmd
    .command('list')
    .alias('ls')
    .description('List all profiles')
    .option('--json', 'Output as JSON')
    .action((options: ProfileListOptions) => {
      const profiles = listProfiles();

      if (profiles.length === 0) {
        output.warn('No profiles configured');
        return;
      }

      if (options.json) {
        output.json(profiles);
      } else {
        console.log('\nProfiles:\n');
        for (const profile of profiles) {
          const activeMarker = profile.active ? ' (active)' : '';
          const authMarker = profile.hasApiKey ? ' [API key]' : profile.hasCredentials ? ' [JWT]' : '';
          console.log(`  ${profile.active ? '→' : ' '} ${profile.name}${activeMarker}${authMarker}`);
          console.log(`      URL: ${profile.url}`);
        }
        console.log('');
      }
    });

  // Show current profile
  profileCmd
    .command('current')
    .description('Show current active profile')
    .option('--json', 'Output as JSON')
    .action((options: ProfileCurrentOptions) => {
      const profileName = getActiveProfileName();
      const profile = getProfile(profileName);

      if (!profile) {
        output.warn(`Profile '${profileName}' not found`);
        return;
      }

      const data = {
        name: profileName,
        url: profile.url,
        insecure: profile.insecure,
        timeout: profile.timeout,
        defaultTenant: profile.defaultTenant,
        authMethod: profile.apiKey ? 'API Key' : profile.credentials ? 'JWT' : 'None',
        hasApiKey: !!profile.apiKey,
        apiKeyPrefix: profile.apiKey ? profile.apiKey.substring(0, 12) + '...' : undefined,
        hasCredentials: !!profile.credentials,
        loggedInAs: profile.credentials?.username,
      };

      if (options.json) {
        output.json(data);
      } else {
        output.keyValue(data);
      }
    });

  // Create profile
  profileCmd
    .command('create <name>')
    .description('Create a new profile')
    .option('--vault-url <url>', 'Vault server URL')
    .option('-k, --insecure', 'Skip TLS certificate verification')
    .option('--copy-from <profile>', 'Copy settings from existing profile')
    .option('--use', 'Switch to this profile after creating')
    .action((name: string, options: ProfileCreateOptions) => {
      try {
        createProfile(name, {
          url: options.vaultUrl,
          insecure: options.insecure,
          copyFrom: options.copyFrom,
        });
        output.success(`Created profile '${name}'`);

        if (options.use) {
          switchProfile(name);
          output.success(`Switched to profile '${name}'`);
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Use/switch profile
  profileCmd
    .command('use <name>')
    .alias('switch')
    .description('Switch to a different profile')
    .action((name: string) => {
      try {
        switchProfile(name);
        const profile = getProfile(name);
        output.success(`Switched to profile '${name}'`);
        if (profile) {
          console.log(`  URL: ${profile.url}`);
          if (profile.credentials) {
            console.log(`  Logged in as: ${profile.credentials.username}`);
          }
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete profile
  profileCmd
    .command('delete <name>')
    .alias('rm')
    .description('Delete a profile')
    .option('-f, --force', 'Skip confirmation')
    .action((name: string, options: ProfileDeleteOptions) => {
      try {
        if (!options.force) {
          const profile = getProfile(name);
          if (profile?.credentials) {
            output.warn(`Profile '${name}' has stored credentials that will be deleted`);
          }
        }

        deleteProfile(name);
        output.success(`Deleted profile '${name}'`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Rename profile
  profileCmd
    .command('rename <old-name> <new-name>')
    .description('Rename a profile')
    .action((oldName: string, newName: string) => {
      try {
        renameProfile(oldName, newName);
        output.success(`Renamed profile '${oldName}' to '${newName}'`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Show profile details
  profileCmd
    .command('show [name]')
    .description('Show profile details')
    .option('--json', 'Output as JSON')
    .action((name: string | undefined, options: ProfileShowOptions) => {
      const profileName = name ?? getActiveProfileName();
      const profile = getProfile(profileName);

      if (!profile) {
        output.error(`Profile '${profileName}' not found`);
        process.exit(1);
      }

      const data = {
        name: profileName,
        url: profile.url,
        insecure: profile.insecure,
        timeout: profile.timeout,
        defaultTenant: profile.defaultTenant ?? 'None',
        authMethod: profile.apiKey ? 'API Key' : profile.credentials ? 'JWT' : 'None',
        hasApiKey: !!profile.apiKey,
        apiKeyPrefix: profile.apiKey ? profile.apiKey.substring(0, 12) + '...' : undefined,
        hasCredentials: !!profile.credentials,
        loggedInAs: profile.credentials?.username ?? 'Not logged in',
        role: profile.credentials?.role,
        tenantId: profile.credentials?.tenantId ?? 'None',
      };

      if (options.json) {
        output.json(data);
      } else {
        output.keyValue(data);
      }
    });
}
