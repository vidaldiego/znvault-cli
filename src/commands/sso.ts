// Path: znvault-cli/src/commands/sso.ts

import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

// ============================================================================
// Types
// ============================================================================

interface SSOApp {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  allowed_origins: string[];
  allowed_scopes: string[];
  allowed_grant_types: string[];
  access_token_ttl_seconds: number;
  refresh_token_ttl_seconds: number;
  require_pkce: boolean;
  active: boolean;
  icon_url: string | null;
  roles: string[];
  default_role: string;
  created_at: string;
  updated_at: string;
  user_count?: number;
  active_token_count?: number;
}

interface SSOAppUser {
  user_id: string;
  username: string;
  email: string | null;
  role: string;
  granted_at: string;
  granted_by: string | null;
  last_used_at: string | null;
}

interface ListOptions {
  tenant?: string;
  status?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface CreateOptions {
  tenant?: string;
  description?: string;
  redirectUri: string[];
  origin?: string[];
  scope?: string[];
  grantType?: string[];
  tokenTtl?: string;
  refreshTtl?: string;
  pkce?: boolean;
  role?: string[];
  defaultRole?: string;
  json?: boolean;
}

interface UpdateOptions {
  name?: string;
  description?: string;
  addRedirectUri?: string[];
  removeRedirectUri?: string[];
  addOrigin?: string[];
  removeOrigin?: string[];
  addScope?: string[];
  removeScope?: string[];
  tokenTtl?: string;
  refreshTtl?: string;
  pkce?: boolean;
  status?: string;
  json?: boolean;
}

interface DeleteOptions {
  yes?: boolean;
}

interface RotateSecretOptions {
  json?: boolean;
}

interface UserListOptions {
  json?: boolean;
}

interface UserGrantOptions {
  role?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ============================================================================
// Commands
// ============================================================================

export function registerSSOCommands(program: Command): void {
  const sso = program
    .command('sso')
    .description('SSO/OAuth2 application management');

  // ---------------------------------------------------------------------------
  // List SSO Apps
  // ---------------------------------------------------------------------------
  sso
    .command('list')
    .description('List SSO applications')
    .option('--tenant <id>', 'Filter by tenant (superadmin only)')
    .option('--status <status>', 'Filter by status (active|inactive)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching SSO apps...').start();

      try {
        const query: Record<string, string> = {};
        if (options.tenant) query.tenantId = options.tenant;
        if (options.status) query.status = options.status;

        const queryString = Object.keys(query).length > 0
          ? '?' + new URLSearchParams(query).toString()
          : '';

        const response = await client.get<{ apps: SSOApp[]; pagination: { total: number } }>(
          `/v1/sso/apps${queryString}`
        );
        spinner.stop();

        if (options.json) {
          output.json(response.apps);
          return;
        }

        if (response.apps.length === 0) {
          output.info('No SSO apps found');
          return;
        }

        output.table(
          ['Name', 'Slug', 'Client ID', 'Status', 'Users', 'Grant Types'],
          response.apps.map(app => [
            app.name,
            app.slug,
            app.client_id.substring(0, 16) + '...',
            app.active ? '✓ Active' : '✗ Inactive',
            app.user_count ?? '-',
            app.allowed_grant_types.join(', '),
          ])
        );

        output.info(`Total: ${response.apps.length} app(s)`);
      } catch (err) {
        spinner.fail('Failed to list SSO apps');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Get SSO App
  // ---------------------------------------------------------------------------
  sso
    .command('get <id>')
    .description('Get SSO app details (by ID or slug)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = ora('Fetching SSO app...').start();

      try {
        const app = await client.get<SSOApp>(`/v1/sso/apps/${encodeURIComponent(id)}`);
        spinner.stop();

        if (options.json) {
          output.json(app);
          return;
        }

        output.section('SSO App Details');
        output.keyValue({
          'Name': app.name,
          'Slug': app.slug,
          'Description': app.description ?? '-',
          'Status': app.active ? '✓ Active' : '✗ Inactive',
          'Client ID': app.client_id,
          'Created': output.formatDate(app.created_at),
          'Updated': output.formatDate(app.updated_at),
        });

        output.section('OAuth Configuration');
        output.keyValue({
          'Redirect URIs': app.redirect_uris.join('\n                  ') || '-',
          'Allowed Origins': app.allowed_origins.join(', ') || '-',
          'Grant Types': app.allowed_grant_types.join(', '),
          'Scopes': app.allowed_scopes.join(', ') || '-',
          'PKCE Required': app.require_pkce ? 'Yes' : 'No',
          'Access Token TTL': formatTtl(app.access_token_ttl_seconds),
          'Refresh Token TTL': formatTtl(app.refresh_token_ttl_seconds),
        });

        output.section('Roles');
        output.keyValue({
          'Available Roles': app.roles.join(', '),
          'Default Role': app.default_role,
        });

        if (app.user_count !== undefined || app.active_token_count !== undefined) {
          output.section('Usage');
          output.keyValue({
            'Users': app.user_count ?? '-',
            'Active Tokens': app.active_token_count ?? '-',
          });
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get SSO app');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Create SSO App
  // ---------------------------------------------------------------------------
  sso
    .command('create <name> <slug>')
    .description('Create a new SSO application')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--description <text>', 'App description')
    .requiredOption('--redirect-uri <uri...>', 'Redirect URIs (required, can specify multiple)')
    .option('--origin <origin...>', 'Allowed CORS origins')
    .option('--scope <scope...>', 'Default scopes', ['openid', 'profile', 'email'])
    .option('--grant-type <type...>', 'Grant types', ['authorization_code', 'refresh_token'])
    .option('--token-ttl <seconds>', 'Access token TTL in seconds', '3600')
    .option('--refresh-ttl <seconds>', 'Refresh token TTL in seconds', '604800')
    .option('--pkce', 'Require PKCE (default: true)')
    .option('--no-pkce', 'Do not require PKCE')
    .option('--role <role...>', 'Available roles', ['admin', 'user'])
    .option('--default-role <role>', 'Default role for new users', 'user')
    .option('--json', 'Output as JSON')
    .action(async (name: string, slug: string, options: CreateOptions) => {
      const spinner = ora('Creating SSO app...').start();

      try {
        const body = {
          name,
          slug,
          description: options.description,
          redirect_uris: options.redirectUri,
          allowed_origins: options.origin || [],
          allowed_scopes: options.scope,
          allowed_grant_types: options.grantType,
          access_token_ttl_seconds: parseInt(String(options.tokenTtl)) || 3600,
          refresh_token_ttl_seconds: parseInt(String(options.refreshTtl)) || 604800,
          require_pkce: options.pkce !== false,
          roles: options.role,
          default_role: options.defaultRole,
        };

        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await client.post<{ app: SSOApp; client_secret: string }>(
          `/v1/sso/apps${query}`,
          body
        );
        spinner.succeed(`SSO app "${name}" created successfully`);

        if (options.json) {
          output.json({ ...response.app, client_secret: response.client_secret });
          return;
        }

        output.section('Client Credentials');
        output.warn('Save the client secret now - it will not be shown again!');
        console.log();
        output.keyValue({
          'Client ID': response.app.client_id,
          'Client Secret': response.client_secret,
        });

        console.log();
        output.info('Redirect URIs:');
        for (const uri of response.app.redirect_uris) {
          console.log(`  • ${uri}`);
        }

        console.log();
        output.section('Example OAuth2 Authorization URL');
        const authUrl = new URL('/oauth/authorize', 'https://vault.example.com');
        authUrl.searchParams.set('client_id', response.app.client_id);
        authUrl.searchParams.set('redirect_uri', response.app.redirect_uris[0]);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', response.app.allowed_scopes.join(' '));
        if (response.app.require_pkce) {
          authUrl.searchParams.set('code_challenge', '<SHA256_HASH>');
          authUrl.searchParams.set('code_challenge_method', 'S256');
        }
        console.log(authUrl.toString().replace('https://vault.example.com', '<VAULT_URL>'));
        console.log();
      } catch (err) {
        spinner.fail('Failed to create SSO app');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Update SSO App
  // ---------------------------------------------------------------------------
  sso
    .command('update <id>')
    .description('Update an SSO application')
    .option('--name <name>', 'New app name')
    .option('--description <text>', 'New description')
    .option('--add-redirect-uri <uri...>', 'Add redirect URIs')
    .option('--remove-redirect-uri <uri...>', 'Remove redirect URIs')
    .option('--add-origin <origin...>', 'Add allowed origins')
    .option('--remove-origin <origin...>', 'Remove allowed origins')
    .option('--add-scope <scope...>', 'Add scopes')
    .option('--remove-scope <scope...>', 'Remove scopes')
    .option('--token-ttl <seconds>', 'Access token TTL in seconds')
    .option('--refresh-ttl <seconds>', 'Refresh token TTL in seconds')
    .option('--pkce', 'Require PKCE')
    .option('--no-pkce', 'Do not require PKCE')
    .option('--status <status>', 'Set status (active|inactive)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdateOptions) => {
      const spinner = ora('Updating SSO app...').start();

      try {
        // First fetch current app to merge arrays
        const current = await client.get<SSOApp>(`/v1/sso/apps/${encodeURIComponent(id)}`);

        // Build update payload
        const updates: Record<string, unknown> = {};

        if (options.name) updates.name = options.name;
        if (options.description !== undefined) updates.description = options.description;

        // Handle redirect URIs
        if (options.addRedirectUri || options.removeRedirectUri) {
          let uris = [...current.redirect_uris];
          if (options.addRedirectUri) {
            uris = [...new Set([...uris, ...options.addRedirectUri])];
          }
          if (options.removeRedirectUri) {
            uris = uris.filter(u => !options.removeRedirectUri!.includes(u));
          }
          updates.redirect_uris = uris;
        }

        // Handle origins
        if (options.addOrigin || options.removeOrigin) {
          let origins = [...current.allowed_origins];
          if (options.addOrigin) {
            origins = [...new Set([...origins, ...options.addOrigin])];
          }
          if (options.removeOrigin) {
            origins = origins.filter(o => !options.removeOrigin!.includes(o));
          }
          updates.allowed_origins = origins;
        }

        // Handle scopes
        if (options.addScope || options.removeScope) {
          let scopes = [...current.allowed_scopes];
          if (options.addScope) {
            scopes = [...new Set([...scopes, ...options.addScope])];
          }
          if (options.removeScope) {
            scopes = scopes.filter(s => !options.removeScope!.includes(s));
          }
          updates.allowed_scopes = scopes;
        }

        if (options.tokenTtl) updates.access_token_ttl_seconds = parseInt(options.tokenTtl);
        if (options.refreshTtl) updates.refresh_token_ttl_seconds = parseInt(options.refreshTtl);
        if (options.pkce !== undefined) updates.require_pkce = options.pkce;
        if (options.status) updates.active = options.status === 'active';

        if (Object.keys(updates).length === 0) {
          spinner.fail('No updates specified');
          output.info('Use --name, --description, --add-redirect-uri, etc.');
          process.exit(1);
        }

        const app = await client.patch<SSOApp>(`/v1/sso/apps/${encodeURIComponent(id)}`, updates);
        spinner.succeed(`SSO app "${app.name}" updated successfully`);

        if (options.json) {
          output.json(app);
          return;
        }

        output.keyValue({
          'Name': app.name,
          'Status': app.active ? '✓ Active' : '✗ Inactive',
          'Redirect URIs': app.redirect_uris.join(', '),
          'Updated': output.formatDate(app.updated_at),
        });
      } catch (err) {
        spinner.fail('Failed to update SSO app');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Delete SSO App
  // ---------------------------------------------------------------------------
  sso
    .command('delete <id>')
    .description('Delete an SSO application')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      try {
        // Fetch app name for confirmation
        const app = await client.get<SSOApp>(`/v1/sso/apps/${encodeURIComponent(id)}`);

        if (!options.yes) {
          output.warn(`This will permanently delete the SSO app "${app.name}" and revoke all tokens.`);
          const confirmed = await promptConfirm('Are you sure you want to delete this app?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting SSO app...').start();

        try {
          await client.delete(`/v1/sso/apps/${encodeURIComponent(id)}`);
          spinner.succeed(`SSO app "${app.name}" deleted successfully`);
        } catch (err) {
          spinner.fail('Failed to delete SSO app');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Rotate Client Secret
  // ---------------------------------------------------------------------------
  sso
    .command('rotate-secret <id>')
    .description('Rotate the client secret for an SSO app')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: RotateSecretOptions) => {
      const spinner = ora('Rotating client secret...').start();

      try {
        const response = await client.post<{ client_secret: string; rotated_at: string }>(
          `/v1/sso/apps/${encodeURIComponent(id)}/rotate-secret`,
          {}
        );
        spinner.succeed('Client secret rotated successfully');

        if (options.json) {
          output.json(response);
          return;
        }

        output.warn('Save the new client secret now - it will not be shown again!');
        console.log();
        output.keyValue({
          'New Client Secret': response.client_secret,
          'Rotated At': output.formatDate(response.rotated_at),
        });
        console.log();
      } catch (err) {
        spinner.fail('Failed to rotate client secret');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // User Access Management
  // ---------------------------------------------------------------------------
  const users = sso
    .command('users')
    .description('Manage user access to SSO apps');

  // List users with access
  users
    .command('list <appId>')
    .description('List users with access to an SSO app')
    .option('--json', 'Output as JSON')
    .action(async (appId: string, options: UserListOptions) => {
      const spinner = ora('Fetching users...').start();

      try {
        const response = await client.get<{ users: SSOAppUser[]; pagination: { total: number } }>(
          `/v1/sso/apps/${encodeURIComponent(appId)}/users`
        );
        spinner.stop();

        if (options.json) {
          output.json(response.users);
          return;
        }

        if (response.users.length === 0) {
          output.info('No users have access to this app');
          return;
        }

        output.table(
          ['Username', 'Email', 'Role', 'Granted At', 'Last Used'],
          response.users.map(u => [
            u.username,
            u.email ?? '-',
            u.role,
            output.formatDate(u.granted_at),
            u.last_used_at ? output.formatDate(u.last_used_at) : 'Never',
          ])
        );

        output.info(`Total: ${response.users.length} user(s)`);
      } catch (err) {
        spinner.fail('Failed to list users');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Grant user access
  users
    .command('grant <appId> <userId>')
    .description('Grant a user access to an SSO app')
    .option('--role <role>', 'Role to assign', 'user')
    .action(async (appId: string, userId: string, options: UserGrantOptions) => {
      const spinner = ora('Granting access...').start();

      try {
        await client.post(`/v1/sso/apps/${encodeURIComponent(appId)}/users`, {
          user_id: userId,
          role: options.role,
        });
        spinner.succeed(`Access granted to user ${userId} with role "${options.role}"`);
      } catch (err) {
        spinner.fail('Failed to grant access');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Revoke user access
  users
    .command('revoke <appId> <userId>')
    .description('Revoke a user\'s access to an SSO app')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (appId: string, userId: string, options: DeleteOptions) => {
      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(`Revoke access for user ${userId}?`);
          if (!confirmed) {
            output.info('Revoke cancelled');
            return;
          }
        }

        const spinner = ora('Revoking access...').start();

        try {
          await client.delete(`/v1/sso/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}`);
          spinner.succeed(`Access revoked for user ${userId}`);
        } catch (err) {
          spinner.fail('Failed to revoke access');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update user role
  users
    .command('set-role <appId> <userId> <role>')
    .description('Update a user\'s role in an SSO app')
    .action(async (appId: string, userId: string, role: string) => {
      const spinner = ora('Updating role...').start();

      try {
        await client.patch(
          `/v1/sso/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}`,
          { role }
        );
        spinner.succeed(`Role updated to "${role}" for user ${userId}`);
      } catch (err) {
        spinner.fail('Failed to update role');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
