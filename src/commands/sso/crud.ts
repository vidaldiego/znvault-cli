// Path: src/commands/sso/crud.ts

/**
 * SSO App CRUD operations (list, get, create, update, delete, rotate-secret)
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import type {
  SSOApp,
  ListAppsResponse,
  CreateAppResponse,
  RotateSecretResponse,
  ListOptions,
  GetOptions,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  RotateSecretOptions,
} from './types.js';
import { formatTtl, buildTenantQuery, ssoAppsBase, withSsoContext } from './helpers.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function listApps(options: ListOptions): Promise<void> {
  const spinner = output.spinner('Fetching SSO apps...').start();

  try {
    const query: Record<string, string> = {};
    if (options.tenant) query.tenantId = options.tenant;
    if (options.status) query.status = options.status;

    const queryString = Object.keys(query).length > 0
      ? '?' + new URLSearchParams(query).toString()
      : '';

    const response = await client.get<ListAppsResponse>(`${ssoAppsBase()}${queryString}`);
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
}

async function getApp(id: string, options: GetOptions): Promise<void> {
  const spinner = output.spinner('Fetching SSO app...').start();

  try {
    const query = buildTenantQuery(options.tenant);
    const app = await client.get<SSOApp>(`${ssoAppsBase()}/${encodeURIComponent(id)}${query}`);
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
      'Grant Types': app.allowed_grant_types.join(', ') || '-',
      'Scopes': app.allowed_scopes.join(', ') || '-',
      'PKCE Required': app.require_pkce ? 'Yes' : 'No',
      'Access Token TTL': formatTtl(app.access_token_ttl_seconds),
      'Refresh Token TTL': formatTtl(app.refresh_token_ttl_seconds),
    });

    output.section('Roles');
    output.keyValue({
      'Available Roles': app.roles.join(', ') || '-',
      'Default Role': app.default_role || '-',
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
}

async function createApp(name: string, slug: string, options: CreateOptions): Promise<void> {
  const spinner = output.spinner('Creating SSO app...').start();

  try {
    const body = {
      name,
      slug,
      description: options.description,
      redirect_uris: options.redirectUri,
      allowed_origins: options.origin ?? [],
      allowed_scopes: options.scope,
      allowed_grant_types: options.grantType,
      access_token_ttl_seconds: parseInt(String(options.tokenTtl)) || 3600,
      refresh_token_ttl_seconds: parseInt(String(options.refreshTtl)) || 604800,
      require_pkce: options.pkce !== false,
      roles: options.role,
      default_role: options.defaultRole,
    };

    const query = buildTenantQuery(options.tenant);
    const response = await client.post<CreateAppResponse>(`${ssoAppsBase()}${query}`, body);
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
}

async function updateApp(id: string, options: UpdateOptions): Promise<void> {
  const spinner = output.spinner('Updating SSO app...').start();

  try {
    const query = buildTenantQuery(options.tenant);

    // First fetch current app to merge arrays
    const current = await client.get<SSOApp>(`${ssoAppsBase()}/${encodeURIComponent(id)}${query}`);

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
      const removeUris = options.removeRedirectUri;
      if (removeUris) {
        uris = uris.filter(u => !removeUris.includes(u));
      }
      updates.redirect_uris = uris;
    }

    // Handle origins
    if (options.addOrigin || options.removeOrigin) {
      let origins = [...current.allowed_origins];
      if (options.addOrigin) {
        origins = [...new Set([...origins, ...options.addOrigin])];
      }
      const removeOrigins = options.removeOrigin;
      if (removeOrigins) {
        origins = origins.filter(o => !removeOrigins.includes(o));
      }
      updates.allowed_origins = origins;
    }

    // Handle scopes
    if (options.addScope || options.removeScope) {
      let scopes = [...current.allowed_scopes];
      if (options.addScope) {
        scopes = [...new Set([...scopes, ...options.addScope])];
      }
      const removeScopes = options.removeScope;
      if (removeScopes) {
        scopes = scopes.filter(s => !removeScopes.includes(s));
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

    const app = await client.patch<SSOApp>(`${ssoAppsBase()}/${encodeURIComponent(id)}${query}`, updates);
    spinner.stop();
    output.success(`SSO app "${app.name}" updated successfully`);

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
}

async function deleteApp(id: string, options: DeleteOptions): Promise<void> {
  try {
    const query = buildTenantQuery(options.tenant);

    // Fetch app name for confirmation
    const app = await client.get<SSOApp>(`${ssoAppsBase()}/${encodeURIComponent(id)}${query}`);

    if (!options.yes) {
      output.warn(`This will permanently delete the SSO app "${app.name}" and revoke all tokens.`);
      const confirmed = await promptConfirm('Are you sure you want to delete this app?');
      if (!confirmed) {
        output.info('Delete cancelled');
        return;
      }
    }

    const spinner = output.spinner('Deleting SSO app...').start();

    try {
      await client.delete(`${ssoAppsBase()}/${encodeURIComponent(id)}${query}`);
      spinner.stop();
      output.success(`SSO app "${app.name}" deleted successfully`);
    } catch (err) {
      spinner.fail('Failed to delete SSO app');
      throw err;
    }
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function rotateSecret(id: string, options: RotateSecretOptions): Promise<void> {
  const spinner = output.spinner('Rotating client secret...').start();

  try {
    const query = buildTenantQuery(options.tenant);
    const response = await client.post<RotateSecretResponse>(
      `${ssoAppsBase()}/${encodeURIComponent(id)}/rotate-secret${query}`,
      {}
    );
    spinner.stop();
    output.success('Client secret rotated successfully');

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
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerCrudCommands(parent: Command, asSuperadmin = false): void {
  // List SSO Apps
  parent
    .command('list')
    .description('List SSO applications')
    .option('--tenant <id>', 'Filter by tenant (superadmin only)')
    .option('--status <status>', 'Filter by status (active|inactive)')
    .option('--json', 'Output as JSON')
    .action((options: ListOptions) => withSsoContext(asSuperadmin, () => listApps(options)));

  // Get SSO App
  parent
    .command('get <id>')
    .description('Get SSO app details (by ID or slug)')
    .option('--tenant <id>', 'Tenant ID (superadmin only, required for slug lookup)')
    .option('--json', 'Output as JSON')
    .action((id: string, options: GetOptions) =>
      withSsoContext(asSuperadmin, () => getApp(id, options))
    );

  // Create SSO App
  parent
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
    .action((name: string, slug: string, options: CreateOptions) =>
      withSsoContext(asSuperadmin, () => createApp(name, slug, options))
    );

  // Update SSO App
  parent
    .command('update <id>')
    .description('Update an SSO application')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
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
    .action((id: string, options: UpdateOptions) =>
      withSsoContext(asSuperadmin, () => updateApp(id, options))
    );

  // Delete SSO App
  parent
    .command('delete <id>')
    .description('Delete an SSO application')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action((id: string, options: DeleteOptions) =>
      withSsoContext(asSuperadmin, () => deleteApp(id, options))
    );

  // Rotate Client Secret
  parent
    .command('rotate-secret <id>')
    .description('Rotate the client secret for an SSO app')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action((id: string, options: RotateSecretOptions) =>
      withSsoContext(asSuperadmin, () => rotateSecret(id, options))
    );
}
