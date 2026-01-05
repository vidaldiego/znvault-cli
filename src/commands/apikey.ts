// Path: znvault-cli/src/commands/apikey.ts
// CLI commands for independent API key management

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';
import type { APIKey, ManagedAPIKey, RotationMode } from '../types/index.js';

// ============================================================================
// Option Interfaces
// ============================================================================

interface ListOptions {
  tenant?: string;
  json?: boolean;
}

interface CreateOptions {
  expires: string;
  permissions?: string;
  description?: string;
  ip?: string;
  timeRange?: string;
  methods?: string;
  resources?: string;
  aliases?: string;
  tags?: string;
  tenant?: string;
  json?: boolean;
}

interface ShowOptions {
  tenant?: string;
  json?: boolean;
}

interface DeleteOptions {
  tenant?: string;
  force?: boolean;
}

interface RotateOptions {
  name?: string;
  tenant?: string;
  json?: boolean;
}

interface EnableDisableOptions {
  tenant?: string;
}

interface UpdatePermissionsOptions {
  set?: string;
  tenant?: string;
  json?: boolean;
}

interface UpdateConditionsOptions {
  ip?: string;
  timeRange?: string;
  methods?: string;
  resources?: string;
  aliases?: string;
  tags?: string;
  clearAll?: boolean;
  tenant?: string;
  json?: boolean;
}

interface ListPoliciesOptions {
  tenant?: string;
  json?: boolean;
}

interface AttachDetachPolicyOptions {
  tenant?: string;
}

interface SelfOptions {
  json?: boolean;
}

interface SelfRotateOptions {
  name?: string;
  json?: boolean;
}

// Managed API Key option interfaces
interface ManagedListOptions {
  tenant?: string;
  json?: boolean;
}

interface ManagedCreateOptions {
  expires: string;
  permissions?: string;
  description?: string;
  rotationMode: string;
  rotationInterval?: string;
  gracePeriod: string;
  notifyBefore?: string;
  webhookUrl?: string;
  ip?: string;
  tenant?: string;
  json?: boolean;
}

interface ManagedGetOptions {
  tenant?: string;
  json?: boolean;
}

interface ManagedBindOptions {
  tenant?: string;
  json?: boolean;
}

interface ManagedRotateOptions {
  tenant?: string;
}

interface ManagedConfigOptions {
  rotationInterval?: string;
  gracePeriod?: string;
  notifyBefore?: string;
  webhookUrl?: string;
  tenant?: string;
  json?: boolean;
}

interface ManagedDeleteOptions {
  tenant?: string;
  force?: boolean;
}

// ============================================================================
// Condition Type Definitions
// ============================================================================

interface TimeRangeCondition {
  start: string;
  end: string;
  timezone?: string;
}

interface ApiKeyConditions {
  ip?: string[];
  timeRange?: TimeRangeCondition;
  methods?: string[];
  resources?: Record<string, string[]>;
  aliases?: string[];
  resourceTags?: Record<string, string>;
  [key: string]: unknown;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function getDaysUntilExpiry(expiresAt: string): number {
  const expires = new Date(expiresAt);
  const now = new Date();
  return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatExpiry(expiresAt: string): string {
  const days = getDaysUntilExpiry(expiresAt);
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 7) return `Expires in ${days} days (!)`;
  if (days <= 30) return `Expires in ${days} days`;
  return `Expires in ${days} days`;
}

function formatPermissions(permissions: string[]): string {
  if (permissions.length === 0) return 'None';
  if (permissions.length <= 3) return permissions.join(', ');
  return `${permissions.slice(0, 2).join(', ')} +${permissions.length - 2} more`;
}

function formatConditionsSummary(conditions?: ApiKeyConditions): string {
  if (!conditions || Object.keys(conditions).length === 0) return '-';

  const parts: string[] = [];
  if (conditions.ip) parts.push('IP');
  if (conditions.timeRange) parts.push('Time');
  if (conditions.methods) parts.push('Methods');
  if (conditions.resources) parts.push('Resources');
  if (conditions.aliases) parts.push('Aliases');
  if (conditions.resourceTags) parts.push('Tags');

  if (parts.length === 0) return '-';
  if (parts.length <= 2) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2}`;
}

function displayConditions(cond: ApiKeyConditions): void {
  if (cond.ip) console.log(`  - IP Allowlist: ${cond.ip.join(', ')}`);
  if (cond.timeRange) {
    const tr = cond.timeRange;
    console.log(`  - Time Range: ${tr.start}-${tr.end} ${tr.timezone ?? 'UTC'}`);
  }
  if (cond.methods) console.log(`  - Methods: ${cond.methods.join(', ')}`);
  if (cond.resources) console.log(`  - Resources: ${JSON.stringify(cond.resources)}`);
  if (cond.aliases) console.log(`  - Aliases: ${cond.aliases.join(', ')}`);
  if (cond.resourceTags) console.log(`  - Tags: ${JSON.stringify(cond.resourceTags)}`);
}

// Managed key helper functions
function formatRotationMode(mode: RotationMode): string {
  switch (mode) {
    case 'scheduled': return 'Scheduled';
    case 'on-use': return 'On Use';
    case 'on-bind': return 'On Bind';
    default: return mode;
  }
}

function formatTimeUntil(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'Now';

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ${diffHours % 24}h`;
}

function displayManagedKeyDetails(key: ManagedAPIKey): void {
  const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

  output.keyValue({
    'Name': key.name,
    'Key ID': key.id,
    'Prefix': key.prefix,
    'Status': statusIcon,
    'Tenant': key.tenant_id,
    'Description': key.description ?? 'None',
    'Rotation Mode': formatRotationMode(key.rotation_mode),
    'Rotation Interval': key.rotation_interval ?? '-',
    'Grace Period': key.grace_period,
    'Next Rotation': key.next_rotation_at ? `${formatDate(key.next_rotation_at)} (${formatTimeUntil(key.next_rotation_at)})` : '-',
    'Last Bound': key.last_bound_at ? formatDate(key.last_bound_at) : 'Never',
    'Rotation Count': key.rotation_count,
    'Last Rotation': key.last_rotation ? formatDate(key.last_rotation) : 'Never',
    'Expires': formatDate(key.expires_at),
    'Created': formatDate(key.created_at),
    'Created By': key.created_by_username ?? key.created_by ?? 'Unknown',
  });

  if (key.notify_before) {
    console.log(`\nNotifications: ${key.notify_before} before rotation`);
  }
  if (key.webhook_url) {
    console.log(`Webhook: ${key.webhook_url}`);
  }

  if (key.permissions.length > 0) {
    console.log('\nPermissions:');
    for (const perm of key.permissions) {
      console.log(`  - ${perm}`);
    }
  }

  const keyConditions = key.conditions as ApiKeyConditions | undefined;
  if (keyConditions && Object.keys(keyConditions).length > 0) {
    console.log('\nConditions:');
    displayConditions(keyConditions);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerApiKeyCommands(program: Command): void {
  const apiKeyCmd = program
    .command('apikey')
    .alias('api-key')
    .description('API key management (independent, tenant-scoped)');

  // List API keys
  apiKeyCmd
    .command('list')
    .alias('ls')
    .description('List API keys')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching API keys...').start();

      try {
        const result = await client.listApiKeys(options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.keys.length === 0) {
          output.warn('No API keys found');
          return;
        }

        // Show expiring soon warning
        if (result.expiringSoon.length > 0) {
          console.log(`\n⚠️  ${result.expiringSoon.length} key(s) expiring within 7 days\n`);
        }

        const table = new Table({
          head: ['Name', 'Prefix', 'Status', 'Tenant', 'Permissions', 'Conditions', 'Expires', 'Rotations'],
          style: { head: ['cyan'] },
        });

        for (const key of result.keys) {
          const daysLeft = getDaysUntilExpiry(key.expires_at);
          const expiryColor = daysLeft <= 7 ? '\x1b[31m' : daysLeft <= 30 ? '\x1b[33m' : '';
          const reset = expiryColor ? '\x1b[0m' : '';
          const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          const statusText = key.enabled ? 'Active' : 'Disabled';

          table.push([
            key.name,
            key.prefix,
            `${statusIcon} ${statusText}`,
            key.tenant_id,
            formatPermissions(key.permissions),
            formatConditionsSummary(key.conditions as ApiKeyConditions | undefined),
            `${expiryColor}${formatExpiry(key.expires_at)}${reset}`,
            key.rotation_count > 0 ? `${key.rotation_count}x` : '-',
          ]);
        }

        console.log(table.toString());
        console.log(`\nTotal: ${result.keys.length} API key(s)`);
      } catch (err) {
        spinner.fail('Failed to list API keys');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Create API key
  apiKeyCmd
    .command('create <name>')
    .description('Create a new API key with direct permissions')
    .option('-e, --expires <days>', 'Days until expiration (1-3650, default: 90)', '90')
    .option('-p, --permissions <perms>', 'Comma-separated permissions (required)')
    .option('-d, --description <desc>', 'Description')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('--time-range <range>', 'Time range restriction: "HH:MM-HH:MM [TIMEZONE]"')
    .option('--methods <methods>', 'Comma-separated allowed HTTP methods: GET,POST,etc')
    .option('--resources <ids>', 'Specific resource IDs (type:id,...): secrets:id1,certificates:id2')
    .option('--aliases <patterns>', 'Comma-separated alias patterns (glob): prod/*,api/*')
    .option('--tags <tags>', 'Required resource tags: key=value,key2=value2')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: CreateOptions) => {
      // Validate permissions
      if (!options.permissions) {
        output.error('--permissions is required. Use comma-separated permission strings.');
        output.info('Example: --permissions "secret:read:value,secret:list:values"');
        process.exit(1);
      }

      const permissions = options.permissions.split(',').map((p) => p.trim());

      const spinner = ora('Creating API key...').start();

      try {
        // Parse options
        const expiresInDays = parseInt(options.expires, 10);
        if (isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          spinner.fail('Invalid expiration');
          output.error('Expiration must be between 1 and 3650 days');
          process.exit(1);
        }

        let ipAllowlist: string[] | undefined;
        if (options.ip) {
          ipAllowlist = options.ip.split(',').map((ip) => ip.trim());
        }

        // Parse conditions
        const conditions: ApiKeyConditions = {};

        // IP condition (from --ip flag, now also stored in conditions)
        if (ipAllowlist) {
          conditions.ip = ipAllowlist;
        }

        // Time range condition
        if (options.timeRange) {
          const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/.exec(options.timeRange);
          if (!match) {
            spinner.fail('Invalid time range format');
            output.error('Use format: "HH:MM-HH:MM [TIMEZONE]"');
            output.info('Example: --time-range "09:00-17:00 America/New_York"');
            process.exit(1);
          }
          conditions.timeRange = {
            start: match[1],
            end: match[2],
            timezone: match[3] || 'UTC',
          };
        }

        // HTTP methods condition
        if (options.methods) {
          conditions.methods = options.methods.split(',').map((m) => m.trim().toUpperCase());
        }

        // Resource IDs condition
        if (options.resources) {
          const resources: Record<string, string[]> = {};
          for (const part of options.resources.split(',')) {
            const [type, id] = part.split(':');
            if (type && id) {
              resources[type] = resources[type] ?? [];
              resources[type].push(id);
            }
          }
          if (Object.keys(resources).length > 0) {
            conditions.resources = resources;
          }
        }

        // Alias patterns condition
        if (options.aliases) {
          conditions.aliases = options.aliases.split(',').map((a) => a.trim());
        }

        // Resource tags condition
        if (options.tags) {
          const tags: Record<string, string> = {};
          for (const part of options.tags.split(',')) {
            const [key, value] = part.split('=');
            if (key && value) {
              tags[key.trim()] = value.trim();
            }
          }
          if (Object.keys(tags).length > 0) {
            conditions.resourceTags = tags;
          }
        }

        const result = await client.createApiKey({
          name,
          description: options.description,
          expiresInDays,
          permissions,
          ipAllowlist,
          conditions: Object.keys(conditions).length > 0 ? conditions : undefined,
          tenantId: options.tenant,
        });

        spinner.succeed('API key created');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n⚠️  IMPORTANT: Save this key now - it will not be shown again!\n');
        console.log('────────────────────────────────────────────────────────────────');
        console.log(`API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Status': result.apiKey.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled',
          'Tenant': result.apiKey.tenant_id,
          'Description': result.apiKey.description ?? 'None',
          'Expires': formatDate(result.apiKey.expires_at),
          'IP Allowlist': result.apiKey.ip_allowlist?.join(', ') ?? 'None',
        });

        if (result.apiKey.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.apiKey.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const apiKeyConditions = result.apiKey.conditions as ApiKeyConditions | undefined;
        if (apiKeyConditions && Object.keys(apiKeyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(apiKeyConditions);
        }
      } catch (err) {
        spinner.fail('Failed to create API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Show API key details
  apiKeyCmd
    .command('show <id>')
    .description('Show API key details')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: ShowOptions) => {
      const spinner = ora('Fetching API key...').start();

      try {
        // First try to get by ID directly
        let key: APIKey | undefined;
        try {
          key = await client.getApiKey(id, options.tenant);
        } catch {
          // Fall back to list and search
          const result = await client.listApiKeys(options.tenant);
          key = result.keys.find(k => k.id === id || k.prefix === id || k.name === id);
        }

        if (!key) {
          spinner.fail('API key not found');
          output.error(`No API key found matching: ${id}`);
          process.exit(1);
        }

        spinner.stop();

        if (options.json) {
          output.json(key);
          return;
        }

        const daysLeft = getDaysUntilExpiry(key.expires_at);
        const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

        output.keyValue({
          'Key ID': key.id,
          'Name': key.name,
          'Prefix': key.prefix,
          'Status': statusIcon,
          'Tenant': key.tenant_id,
          'Description': key.description ?? 'None',
          'Created By': key.created_by_username ?? key.created_by ?? 'Unknown',
          'Created': formatDate(key.created_at),
          'Expires': formatDate(key.expires_at),
          'Days Until Expiry': daysLeft,
          'Last Used': key.last_used ? formatDate(key.last_used) : 'Never',
          'Rotation Count': key.rotation_count,
          'Last Rotation': key.last_rotation ? formatDate(key.last_rotation) : 'Never',
          'IP Allowlist': key.ip_allowlist?.join(', ') ?? 'None (any IP)',
        });

        if (key.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of key.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const keyConditions = key.conditions as ApiKeyConditions | undefined;
        if (keyConditions && Object.keys(keyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(keyConditions);
        }

        if (!key.enabled) {
          console.log('\n⚠️  This key is disabled and cannot be used for authentication.');
        } else if (daysLeft <= 7) {
          console.log('\n⚠️  This key is expiring soon! Consider rotating it.');
        }
      } catch (err) {
        spinner.fail('Failed to fetch API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete API key
  apiKeyCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      if (!options.force) {
        output.warn(`This will permanently delete API key: ${id}`);
        output.warn('The key will stop working immediately.');
      }

      const spinner = ora('Deleting API key...').start();

      try {
        await client.deleteApiKey(id, options.tenant);
        spinner.succeed(`API key deleted: ${id}`);
      } catch (err) {
        spinner.fail('Failed to delete API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Rotate API key
  apiKeyCmd
    .command('rotate <id>')
    .description('Rotate an API key (creates new key, invalidates old)')
    .option('-n, --name <name>', 'New name for the rotated key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: RotateOptions) => {
      const spinner = ora('Rotating API key...').start();

      try {
        const result = await client.rotateApiKey(id, options.name, options.tenant);
        spinner.succeed('API key rotated');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n⚠️  IMPORTANT: Save this new key now - it will not be shown again!');
        console.log('The old key has been invalidated.\n');
        console.log('────────────────────────────────────────────────────────────────');
        console.log(`New API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'New Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Expires': formatDate(result.apiKey.expires_at),
          'Rotation Count': result.apiKey.rotation_count,
        });
      } catch (err) {
        spinner.fail('Failed to rotate API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Enable API key
  apiKeyCmd
    .command('enable <id>')
    .description('Enable an API key (allow authentication)')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (id: string, options: EnableDisableOptions) => {
      const spinner = ora('Enabling API key...').start();

      try {
        const key = await client.setApiKeyEnabled(id, true, options.tenant);
        spinner.succeed(`API key enabled: ${key.name}`);
        console.log('\nThe key can now be used for authentication.');
      } catch (err) {
        spinner.fail('Failed to enable API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Disable API key
  apiKeyCmd
    .command('disable <id>')
    .description('Disable an API key (block authentication without deleting)')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (id: string, options: EnableDisableOptions) => {
      const spinner = ora('Disabling API key...').start();

      try {
        const key = await client.setApiKeyEnabled(id, false, options.tenant);
        spinner.succeed(`API key disabled: ${key.name}`);
        console.log('\nThe key is now blocked from authentication.');
        console.log('Use "znvault apikey enable" to re-enable it.');
      } catch (err) {
        spinner.fail('Failed to disable API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update permissions
  apiKeyCmd
    .command('update-permissions <id>')
    .description('Update API key permissions')
    .option('-s, --set <perms>', 'Set permissions (comma-separated, replaces all)')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdatePermissionsOptions) => {
      if (!options.set) {
        output.error('--set is required. Provide comma-separated permissions.');
        process.exit(1);
      }

      const permissions = options.set.split(',').map((p) => p.trim());

      const spinner = ora('Updating permissions...').start();

      try {
        const key = await client.updateApiKeyPermissions(id, permissions, options.tenant);
        spinner.succeed('Permissions updated');

        if (options.json) {
          output.json(key);
          return;
        }

        console.log('\nUpdated permissions:');
        for (const perm of key.permissions) {
          console.log(`  - ${perm}`);
        }
      } catch (err) {
        spinner.fail('Failed to update permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update conditions
  apiKeyCmd
    .command('update-conditions <id>')
    .description('Update API key inline ABAC conditions')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('--time-range <range>', 'Time range: "HH:MM-HH:MM [TIMEZONE]" or "clear"')
    .option('--methods <methods>', 'Comma-separated HTTP methods or "clear"')
    .option('--resources <ids>', 'Resource IDs (type:id,...) or "clear"')
    .option('--aliases <patterns>', 'Alias patterns (glob) or "clear"')
    .option('--tags <tags>', 'Resource tags (key=value,...) or "clear"')
    .option('--clear-all', 'Remove all conditions')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdateConditionsOptions) => {
      const conditions: ApiKeyConditions = {};

      // Handle --clear-all
      if (!options.clearAll) {
        // Parse individual conditions
        if (options.ip && options.ip !== 'clear') {
          conditions.ip = options.ip.split(',').map((ip) => ip.trim());
        }

        if (options.timeRange) {
          if (options.timeRange !== 'clear') {
            const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/.exec(options.timeRange);
            if (!match) {
              output.error('Invalid time range format. Use: "HH:MM-HH:MM [TIMEZONE]"');
              process.exit(1);
            }
            conditions.timeRange = {
              start: match[1],
              end: match[2],
              timezone: match[3] || 'UTC',
            };
          }
        }

        if (options.methods && options.methods !== 'clear') {
          conditions.methods = options.methods.split(',').map((m) => m.trim().toUpperCase());
        }

        if (options.resources && options.resources !== 'clear') {
          const resources: Record<string, string[]> = {};
          for (const part of options.resources.split(',')) {
            const [type, resId] = part.split(':');
            if (type && resId) {
              resources[type] = resources[type] ?? [];
              resources[type].push(resId);
            }
          }
          if (Object.keys(resources).length > 0) {
            conditions.resources = resources;
          }
        }

        if (options.aliases && options.aliases !== 'clear') {
          conditions.aliases = options.aliases.split(',').map((a) => a.trim());
        }

        if (options.tags && options.tags !== 'clear') {
          const tags: Record<string, string> = {};
          for (const part of options.tags.split(',')) {
            const [key, value] = part.split('=');
            if (key && value) {
              tags[key.trim()] = value.trim();
            }
          }
          if (Object.keys(tags).length > 0) {
            conditions.resourceTags = tags;
          }
        }
      }

      const spinner = ora('Updating conditions...').start();

      try {
        const key = await client.updateApiKeyConditions(id, conditions, options.tenant);
        spinner.succeed('Conditions updated');

        if (options.json) {
          output.json(key);
          return;
        }

        const keyConditions = key.conditions as ApiKeyConditions | undefined;
        if (keyConditions && Object.keys(keyConditions).length > 0) {
          console.log('\nUpdated conditions:');
          displayConditions(keyConditions);
        } else {
          console.log('\nAll conditions cleared.');
        }
      } catch (err) {
        spinner.fail('Failed to update conditions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // List policies attached to an API key
  apiKeyCmd
    .command('list-policies <id>')
    .description('List ABAC policies attached to an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: ListPoliciesOptions) => {
      const spinner = ora('Fetching policies...').start();

      try {
        const result = await client.getApiKeyPolicies(id, options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.policies.length === 0) {
          output.info('No ABAC policies attached to this API key');
          return;
        }

        const table = new Table({
          head: ['Policy ID', 'Policy Name', 'Attached At'],
          style: { head: ['cyan'] },
        });

        for (const policy of result.policies) {
          table.push([
            policy.policyId,
            policy.policyName,
            formatDate(policy.attachedAt),
          ]);
        }

        console.log(table.toString());
        console.log(`\nTotal: ${result.policies.length} policy/policies`);
      } catch (err) {
        spinner.fail('Failed to fetch policies');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Attach policy to API key
  apiKeyCmd
    .command('attach-policy <keyId> <policyId>')
    .description('Attach an ABAC policy to an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (keyId: string, policyId: string, options: AttachDetachPolicyOptions) => {
      const spinner = ora('Attaching policy...').start();

      try {
        await client.attachApiKeyPolicy(keyId, policyId, options.tenant);
        spinner.succeed(`Policy ${policyId} attached to API key ${keyId}`);
      } catch (err) {
        spinner.fail('Failed to attach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Detach policy from API key
  apiKeyCmd
    .command('detach-policy <keyId> <policyId>')
    .description('Detach an ABAC policy from an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (keyId: string, policyId: string, options: AttachDetachPolicyOptions) => {
      const spinner = ora('Detaching policy...').start();

      try {
        await client.detachApiKeyPolicy(keyId, policyId, options.tenant);
        spinner.succeed(`Policy ${policyId} detached from API key ${keyId}`);
      } catch (err) {
        spinner.fail('Failed to detach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Self-info (when using API key auth)
  apiKeyCmd
    .command('self')
    .description('Show info about the currently used API key')
    .option('--json', 'Output as JSON')
    .action(async (options: SelfOptions) => {
      const spinner = ora('Fetching API key info...').start();

      try {
        const result = await client.getApiKeySelf();
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        const statusIcon = result.apiKey.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

        output.keyValue({
          'Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Status': statusIcon,
          'Tenant': result.apiKey.tenant_id,
          'Description': result.apiKey.description ?? 'None',
          'Expires': formatDate(result.apiKey.expires_at),
          'Days Until Expiry': result.expiresInDays,
          'Expiring Soon': result.isExpiringSoon ? 'Yes (!)' : 'No',
          'Last Used': result.apiKey.last_used ? formatDate(result.apiKey.last_used) : 'Never',
          'Rotation Count': result.apiKey.rotation_count,
          'Last Rotation': result.apiKey.last_rotation ? formatDate(result.apiKey.last_rotation) : 'Never',
        });

        if (result.apiKey.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.apiKey.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        // Display conditions if any
        const apiKeyConditions = result.apiKey.conditions as ApiKeyConditions | undefined;
        if (apiKeyConditions && Object.keys(apiKeyConditions).length > 0) {
          console.log('\nConditions:');
          displayConditions(apiKeyConditions);
        }

        if (result.isExpiringSoon) {
          console.log('\n⚠️  This key is expiring soon! Run "znvault apikey self-rotate" to rotate it.');
        }
      } catch (err) {
        spinner.fail('Failed to fetch API key info');
        output.error(err instanceof Error ? err.message : String(err));
        console.log('\nNote: This command only works when authenticated via API key (X-API-Key header).');
        process.exit(1);
      }
    });

  // Self-rotate (when using API key auth)
  apiKeyCmd
    .command('self-rotate')
    .description('Rotate the currently used API key')
    .option('-n, --name <name>', 'New name for the rotated key')
    .option('--json', 'Output as JSON')
    .action(async (options: SelfRotateOptions) => {
      const spinner = ora('Rotating API key...').start();

      try {
        const result = await client.rotateApiKeySelf(options.name);
        spinner.succeed('API key rotated');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n⚠️  IMPORTANT: Save this new key now - it will not be shown again!');
        console.log('The old key has been invalidated.\n');
        console.log('────────────────────────────────────────────────────────────────');
        console.log(`New API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'New Key ID': result.apiKey.id,
          'Name': result.apiKey.name,
          'Prefix': result.apiKey.prefix,
          'Expires': formatDate(result.apiKey.expires_at),
          'Days Until Expiry': result.expiresInDays,
          'Rotation Count': result.apiKey.rotation_count,
        });
      } catch (err) {
        spinner.fail('Failed to rotate API key');
        output.error(err instanceof Error ? err.message : String(err));
        console.log('\nNote: This command only works when authenticated via API key (X-API-Key header).');
        process.exit(1);
      }
    });

  // ============================================================================
  // Managed API Key Commands
  // ============================================================================

  const managedCmd = apiKeyCmd
    .command('managed')
    .description('Managed API key operations (auto-rotating keys)');

  // List managed keys
  managedCmd
    .command('list')
    .alias('ls')
    .description('List all managed API keys')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ManagedListOptions) => {
      const spinner = ora('Fetching managed API keys...').start();

      try {
        const result = await client.listManagedApiKeys(options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.keys.length === 0) {
          output.warn('No managed API keys found');
          return;
        }

        const table = new Table({
          head: ['Name', 'Mode', 'Interval', 'Grace', 'Next Rotation', 'Status', 'Tenant', 'Rotations'],
          style: { head: ['cyan'] },
        });

        for (const key of result.keys) {
          const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
          const nextRotation = key.next_rotation_at ? formatTimeUntil(key.next_rotation_at) : '-';

          table.push([
            key.name,
            formatRotationMode(key.rotation_mode),
            key.rotation_interval ?? '-',
            key.grace_period,
            nextRotation,
            `${statusIcon} ${key.enabled ? 'Active' : 'Disabled'}`,
            key.tenant_id,
            key.rotation_count > 0 ? `${key.rotation_count}x` : '-',
          ]);
        }

        console.log(table.toString());
        console.log(`\nTotal: ${result.keys.length} managed API key(s)`);
      } catch (err) {
        spinner.fail('Failed to list managed API keys');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Create managed key
  managedCmd
    .command('create <name>')
    .description('Create a new managed API key with auto-rotation')
    .option('-e, --expires <days>', 'Days until expiration (1-3650, default: 365)', '365')
    .option('-p, --permissions <perms>', 'Comma-separated permissions (required)')
    .option('-d, --description <desc>', 'Description')
    .option('-m, --rotation-mode <mode>', 'Rotation mode: scheduled, on-use, on-bind (required)')
    .option('-i, --rotation-interval <interval>', 'Rotation interval (e.g., 24h, 7d) - required for scheduled mode')
    .option('-g, --grace-period <period>', 'Grace period (e.g., 5m, 1h)', '5m')
    .option('--notify-before <duration>', 'Notify before rotation (e.g., 1h)')
    .option('--webhook-url <url>', 'Webhook URL for rotation notifications')
    .option('--ip <ips>', 'Comma-separated IP allowlist (CIDR supported)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedCreateOptions) => {
      // Validate required options
      if (!options.permissions) {
        output.error('--permissions is required. Use comma-separated permission strings.');
        process.exit(1);
      }

      if (!options.rotationMode) {
        output.error('--rotation-mode is required. Use: scheduled, on-use, or on-bind');
        process.exit(1);
      }

      const rotationMode = options.rotationMode as RotationMode;
      if (!['scheduled', 'on-use', 'on-bind'].includes(rotationMode)) {
        output.error('Invalid rotation mode. Use: scheduled, on-use, or on-bind');
        process.exit(1);
      }

      if (rotationMode === 'scheduled' && !options.rotationInterval) {
        output.error('--rotation-interval is required for scheduled rotation mode');
        output.info('Example: --rotation-interval 24h');
        process.exit(1);
      }

      const permissions = options.permissions.split(',').map((p) => p.trim());
      const spinner = ora('Creating managed API key...').start();

      try {
        const expiresInDays = parseInt(options.expires, 10);
        if (isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          spinner.fail('Invalid expiration');
          output.error('Expiration must be between 1 and 3650 days');
          process.exit(1);
        }

        const result = await client.createManagedApiKey({
          name,
          description: options.description,
          expiresInDays,
          permissions,
          tenantId: options.tenant,
          ipAllowlist: options.ip?.split(',').map((ip) => ip.trim()),
          managed: {
            rotationMode,
            rotationInterval: options.rotationInterval,
            gracePeriod: options.gracePeriod,
            notifyBefore: options.notifyBefore,
            webhookUrl: options.webhookUrl,
          },
        });

        spinner.succeed('Managed API key created');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n✓ Managed API key created successfully');
        console.log('\nNote: Managed keys do not show the key value at creation.');
        console.log('Use "znvault apikey managed bind <name>" to get the current key value.\n');

        displayManagedKeyDetails(result.apiKey);
      } catch (err) {
        spinner.fail('Failed to create managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get managed key details
  managedCmd
    .command('get <name>')
    .alias('show')
    .description('Show managed API key details')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedGetOptions) => {
      const spinner = ora('Fetching managed API key...').start();

      try {
        const key = await client.getManagedApiKey(name, options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(key);
          return;
        }

        displayManagedKeyDetails(key);
      } catch (err) {
        spinner.fail('Failed to fetch managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Bind to managed key (get current key value)
  managedCmd
    .command('bind <name>')
    .description('Bind to a managed key and get the current key value')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedBindOptions) => {
      const spinner = ora('Binding to managed API key...').start();

      try {
        const result = await client.bindManagedApiKey(name, options.tenant);
        spinner.succeed('Bound to managed API key');

        if (options.json) {
          output.json(result);
          return;
        }

        console.log('\n────────────────────────────────────────────────────────────────');
        console.log(`API Key: ${result.key}`);
        console.log('────────────────────────────────────────────────────────────────\n');

        output.keyValue({
          'Name': result.name,
          'Key ID': result.id,
          'Prefix': result.prefix,
          'Rotation Mode': formatRotationMode(result.rotationMode),
          'Next Rotation': result.nextRotationAt ? `${formatDate(result.nextRotationAt)} (${formatTimeUntil(result.nextRotationAt)})` : '-',
          'Grace Period': result.gracePeriod,
          'Grace Expires': result.graceExpiresAt ? formatDate(result.graceExpiresAt) : '-',
          'Key Expires': formatDate(result.expiresAt),
        });

        if (result.permissions.length > 0) {
          console.log('\nPermissions:');
          for (const perm of result.permissions) {
            console.log(`  - ${perm}`);
          }
        }

        if (result._notice) {
          console.log(`\n⚠️  ${result._notice}`);
        }
      } catch (err) {
        spinner.fail('Failed to bind to managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Force rotate managed key
  managedCmd
    .command('rotate <name>')
    .description('Force immediate rotation of a managed key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .action(async (name: string, options: ManagedRotateOptions) => {
      const spinner = ora('Rotating managed API key...').start();

      try {
        const result = await client.rotateManagedApiKey(name, options.tenant);
        spinner.succeed('Managed API key rotated');

        console.log(`\n${result.message}`);
        if (result.nextRotationAt) {
          console.log(`Next scheduled rotation: ${formatDate(result.nextRotationAt)}`);
        }
        console.log('\nUse "znvault apikey managed bind <name>" to get the new key value.');
      } catch (err) {
        spinner.fail('Failed to rotate managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update managed key config
  managedCmd
    .command('config <name>')
    .description('Update managed key rotation configuration')
    .option('-i, --rotation-interval <interval>', 'Rotation interval (e.g., 24h, 7d)')
    .option('-g, --grace-period <period>', 'Grace period (e.g., 5m, 1h)')
    .option('--notify-before <duration>', 'Notify before rotation (e.g., 1h)')
    .option('--webhook-url <url>', 'Webhook URL for rotation notifications')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: ManagedConfigOptions) => {
      // Check if at least one config option is provided
      if (!options.rotationInterval && !options.gracePeriod && !options.notifyBefore && !options.webhookUrl) {
        output.error('At least one configuration option is required');
        output.info('Options: --rotation-interval, --grace-period, --notify-before, --webhook-url');
        process.exit(1);
      }

      const spinner = ora('Updating managed API key config...').start();

      try {
        const key = await client.updateManagedApiKeyConfig(name, {
          rotationInterval: options.rotationInterval,
          gracePeriod: options.gracePeriod,
          notifyBefore: options.notifyBefore,
          webhookUrl: options.webhookUrl,
        }, options.tenant);

        spinner.succeed('Configuration updated');

        if (options.json) {
          output.json(key);
          return;
        }

        console.log('\nUpdated configuration:');
        output.keyValue({
          'Rotation Interval': key.rotation_interval ?? '-',
          'Grace Period': key.grace_period,
          'Notify Before': key.notify_before ?? '-',
          'Webhook URL': key.webhook_url ?? '-',
          'Next Rotation': key.next_rotation_at ? formatDate(key.next_rotation_at) : '-',
        });
      } catch (err) {
        spinner.fail('Failed to update configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete managed key
  managedCmd
    .command('delete <name>')
    .alias('rm')
    .description('Delete a managed API key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name: string, options: ManagedDeleteOptions) => {
      if (!options.force) {
        output.warn(`This will permanently delete managed API key: ${name}`);
        output.warn('All bound applications will lose access immediately.');
      }

      const spinner = ora('Deleting managed API key...').start();

      try {
        await client.deleteManagedApiKey(name, options.tenant);
        spinner.succeed(`Managed API key deleted: ${name}`);
      } catch (err) {
        spinner.fail('Failed to delete managed API key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
