// Path: src/commands/dynamic-secrets/role.ts

/**
 * Role commands for dynamic secrets
 */


import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DbRole, DbRoleCreateResponse, RoleCreateOptions, RoleUpdateOptions } from './types.js';
import { formatDate, formatTtl } from './helpers.js';

export async function listRoles(options: { connection?: string; json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching roles...').start();

  try {
    let url = '/v1/dynamic-secrets/roles';
    if (options.connection) {
      url = `/v1/dynamic-secrets/connections/${options.connection}/roles`;
    }

    const response = await client.get<DbRole[]>(url);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.length === 0) {
      output.info('No roles found.');
      return;
    }

    const table = new Table({
      head: ['Name', 'Connection', 'Enabled', 'Default TTL', 'Max TTL', 'Active Leases'],
      style: { head: ['cyan'] },
    });

    for (const role of response) {
      table.push([
        role.name,
        role.connectionName ?? role.connectionId.substring(0, 8),
        role.isEnabled ? 'Yes' : 'No',
        formatTtl(role.defaultTtlSeconds),
        formatTtl(role.maxTtlSeconds),
        String(role.activeLeases ?? 0),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.length} role(s) found`);
  } catch (err) {
    spinner.fail('Failed to list roles');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getRole(roleId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching role...').start();

  try {
    const response = await client.get<DbRole>(`/v1/dynamic-secrets/roles/${roleId}`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Name': response.name,
      'Description': response.description ?? '-',
      'Connection': response.connectionName ?? response.connectionId,
      'Enabled': response.isEnabled ? 'Yes' : 'No',
      'Username Template': response.usernameTemplate,
      'Default TTL': formatTtl(response.defaultTtlSeconds),
      'Max TTL': formatTtl(response.maxTtlSeconds),
      'Active Leases': String(response.activeLeases ?? 0),
      'Created': formatDate(response.createdAt),
      'Updated': formatDate(response.updatedAt),
    });
  } catch (err) {
    spinner.fail('Failed to get role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Fields that only make sense for a hand-written (raw) role. Sending any of
 * these alongside `template` conflicts with the server's fixed-schema
 * template mode (400 `template_and_raw_conflict` / `username_template_not_allowed`).
 */
const RAW_ONLY_FLAGS: Array<{ flag: keyof RoleCreateOptions; label: string }> = [
  { flag: 'creationStatements', label: '--creation-statements' },
  { flag: 'revocationStatements', label: '--revocation-statements' },
  { flag: 'renewStatements', label: '--renew-statements' },
  { flag: 'usernameTemplate', label: '--username-template' },
];

export async function createRole(connectionId: string, options: RoleCreateOptions): Promise<void> {
  // Exactly one mode: template XOR raw. Catch the obvious conflicts
  // client-side with a clear message rather than round-tripping to the
  // server for a 400 template_and_raw_conflict / username_template_not_allowed.
  if (options.template) {
    const conflicting = RAW_ONLY_FLAGS.filter(({ flag }) => options[flag] !== undefined);
    if (conflicting.length > 0) {
      output.error(
        `--template cannot be combined with raw role flags (${conflicting.map((c) => c.label).join(', ')}). ` +
        'Pick exactly one mode: template (--template) XOR raw (--creation-statements/--revocation-statements/...).',
      );
      process.exit(1);
    }
  }

  // Interactive prompts if options not provided — but only in raw mode.
  // Template mode has a fixed schema (name + template only), so there is
  // nothing else to prompt for.
  const name = options.name ?? (await inquirer.prompt<{ name: string }>([{
    type: 'input',
    name: 'name',
    message: 'Role name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const spinner = output.spinner('Creating role...').start();

  try {
    let body: Record<string, unknown>;

    if (options.template) {
      const template: { name: string; version?: number } = { name: options.template };
      if (options.templateVersion) {
        const version = parseInt(options.templateVersion, 10);
        if (!Number.isInteger(version) || version < 1) {
          spinner.fail('Failed to create role');
          output.error('--template-version must be a positive integer');
          process.exit(1);
        }
        template.version = version;
      }
      body = { name, template };
    } else {
      const creationStatements = options.creationStatements?.split(';').filter(s => s.trim()) ??
        (await inquirer.prompt<{ statements: string }>([{
          type: 'editor',
          name: 'statements',
          message: 'Creation SQL statements (one per line, use {{username}} and {{password}} placeholders):',
        }])).statements.split('\n').filter(s => s.trim());

      const revocationStatements = options.revocationStatements?.split(';').filter(s => s.trim()) ??
        (await inquirer.prompt<{ statements: string }>([{
          type: 'editor',
          name: 'statements',
          message: 'Revocation SQL statements (one per line, use {{username}} placeholder):',
        }])).statements.split('\n').filter(s => s.trim());

      body = {
        name,
        creationStatements,
        revocationStatements,
      };

      if (options.renewStatements) body.renewStatements = options.renewStatements.split(';').filter(s => s.trim());
      if (options.usernameTemplate) body.usernameTemplate = options.usernameTemplate;
    }

    if (options.description) body.description = options.description;
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);

    const response = await client.post<DbRoleCreateResponse>(`/v1/dynamic-secrets/connections/${connectionId}/roles`, body);
    spinner.succeed('Role created');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Role "${response.name}" created with ID: ${response.id}`);
      if (response.warnings && response.warnings.length > 0) {
        for (const warning of response.warnings) {
          output.warn(describeRoleWarning(warning));
        }
      }
    }
  } catch (err) {
    spinner.fail('Failed to create role');
    output.error(describeRoleCreateError(err, options));
    process.exit(1);
  }
}

/**
 * Expand a terse server warning code into an actionable message. Unknown
 * codes are printed as-is so a new server-side warning never gets swallowed.
 */
function describeRoleWarning(warning: string): string {
  if (warning === 'bundle_not_applied') {
    return 'bundle_not_applied: this role was created, but the znapi-helpers routine bundle has not been ' +
      'applied to the connection yet. The role\'s EXECUTE grant will fail at credential-generation time until ' +
      'the bundle is applied — either during initial provisioning ("dynasec connection provision ... ' +
      '--routines-bundle znapi-helpers --routines-version 1") or by re-running provisioning\'s routines step ' +
      'against this connection.';
  }
  return warning;
}

/**
 * Map known server error codes (see docs/DYNAMIC_SECRETS_GUIDE.md → Role
 * Templates) to a clearer, actionable message. Falls back to the raw error
 * message for anything not explicitly handled here.
 */
function describeRoleCreateError(err: unknown, options: RoleCreateOptions): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { errorCode?: string; statusCode?: number } | null)?.errorCode ?? raw;
  const status = (err as { statusCode?: number } | null)?.statusCode;

  switch (code) {
    case 'template_and_raw_conflict':
      return `${raw} — pick exactly one mode: template (--template) XOR raw (--creation-statements/...).`;
    case 'unknown_template':
      return `${raw} — run "znvault dynasec templates list" to see available templates for this connection's engine.`;
    case 'ddl_unsupported_for_engine':
      return `${raw} — PostgreSQL connections only support the "readonly" and "readwrite" templates ` +
        '("ddl" and "migrate" are MySQL-only).';
    case 'schema_override_unsupported':
      return `${raw} — role templates use a fixed schema (the connection's database for MySQL, "public" for ` +
        'PostgreSQL); a custom schema cannot be specified in template mode.';
    case 'template_param_invalid':
      return `${raw} — check the template's expected params with "znvault dynasec templates get <engine>/<name>/<version>".`;
    case 'username_template_not_allowed':
      return `${raw} — a custom --username-template cannot be combined with --template; templates use a fixed ` +
        'username scheme.';
    default:
      if (status === 403 && !options.template) {
        return `${raw} — creating a role with raw SQL (--creation-statements/--revocation-statements) requires ` +
          'the "dynamic-secrets:roles:write-raw" permission, which is not auto-granted. Ask an admin to grant it, ' +
          'or use --template instead (see "znvault dynasec templates list").';
      }
      return raw;
  }
}

export async function updateRole(roleId: string, options: RoleUpdateOptions): Promise<void> {
  const spinner = output.spinner('Updating role...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.description !== undefined) body.description = options.description;
    if (options.creationStatements) body.creationStatements = options.creationStatements.split(';').filter(s => s.trim());
    if (options.revocationStatements) body.revocationStatements = options.revocationStatements.split(';').filter(s => s.trim());
    if (options.renewStatements) body.renewStatements = options.renewStatements.split(';').filter(s => s.trim());
    if (options.defaultTtl) body.defaultTtlSeconds = parseInt(options.defaultTtl, 10);
    if (options.maxTtl) body.maxTtlSeconds = parseInt(options.maxTtl, 10);
    if (options.enabled !== undefined) body.isEnabled = options.enabled === 'true';

    const response = await client.patch<DbRole>(`/v1/dynamic-secrets/roles/${roleId}`, body);
    spinner.succeed('Role updated');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Role "${response.name}" updated`);
    }
  } catch (err) {
    spinner.fail('Failed to update role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteRole(roleId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete this role? Active leases will be revoked.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = output.spinner('Deleting role...').start();

  try {
    await client.delete(`/v1/dynamic-secrets/roles/${roleId}`);
    spinner.succeed('Role deleted');

    if (options.json) {
      output.json({ success: true, roleId });
    }
  } catch (err) {
    spinner.fail('Failed to delete role');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
