// Path: src/commands/dynamic-secrets/templates.ts

/**
 * `znvault dynasec templates` — browse the server's fixed, versioned
 * role-creation templates (Task E3, mirrors S2's server-side template
 * catalog).
 *
 * Routes (public within a tenant session, no tenantId accepted per the
 * golden rule — the server infers engine support from the connection when
 * a role is actually created):
 *   GET /v1/dynamic-secrets/templates[?engine=mysql|postgresql]
 *   GET /v1/dynamic-secrets/templates/:engine/:name/:version
 *
 * Templates are fixed in code and versioned server-side — there is no
 * create/update/delete here, only list/get. MySQL ships readonly/readwrite/
 * ddl/migrate; PostgreSQL ships readonly/readwrite only (ddl/migrate are
 * MySQL-only — creating a role with those on a PG connection 400s with
 * `ddl_unsupported_for_engine`).
 */

import type { Command } from 'commander';
import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  RoleTemplateDetail,
  RoleTemplateSummary,
  TemplateGetOptions,
  TemplatesListOptions,
} from './types.js';

interface TemplatesListResponse {
  items: RoleTemplateSummary[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

const VALID_ENGINES = new Set(['mysql', 'postgresql']);

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function listTemplates(options: TemplatesListOptions): Promise<void> {
  if (options.engine && !VALID_ENGINES.has(options.engine)) {
    output.error(`--engine must be one of: ${Array.from(VALID_ENGINES).join(', ')}`);
    process.exit(1);
  }

  const spinner = output.spinner('Fetching role templates...').start();

  try {
    const url = options.engine
      ? `/v1/dynamic-secrets/templates?engine=${encodeURIComponent(options.engine)}`
      : '/v1/dynamic-secrets/templates';
    const response = await client.get<TemplatesListResponse>(url);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.items.length === 0) {
      output.info('No templates found.');
      return;
    }

    const table = new Table({
      head: ['Engine', 'Name', 'Version', 'Description'],
      style: { head: ['cyan'] },
    });

    for (const t of response.items) {
      table.push([t.engine, t.name, String(t.version), t.description]);
    }

    console.log(table.toString());
    output.info(`${response.items.length} template(s) found`);
  } catch (err) {
    spinner.fail('Failed to list templates');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Parse the `<engine>/<name>/<version>` positional argument. Kept strict
 * (exactly 3 slash-separated, non-empty segments, numeric version) so a
 * malformed argument fails fast client-side instead of a confusing 404.
 */
function parseTemplateRef(ref: string): { engine: string; name: string; version: string } | null {
  const parts = ref.split('/');
  if (parts.length !== 3 || parts.some((p) => p.trim() === '')) {
    return null;
  }
  const [engine, name, version] = parts;
  return { engine, name, version };
}

export async function getTemplate(engineNameVersion: string, options: TemplateGetOptions): Promise<void> {
  const parsed = parseTemplateRef(engineNameVersion);
  if (!parsed) {
    output.error(`Invalid template reference "${engineNameVersion}" — expected the form engine/name/version (e.g. mysql/readwrite/1).`);
    process.exit(1);
  }
  const { engine, name, version } = parsed;

  const spinner = output.spinner('Fetching template...').start();

  try {
    const response = await client.get<RoleTemplateDetail>(
      `/v1/dynamic-secrets/templates/${encodeURIComponent(engine)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'Engine': response.engine,
      'Name': response.name,
      'Version': String(response.version),
      'Description': response.description,
    });

    const params = response.params;
    const paramEntries = Object.entries(params);
    if (paramEntries.length > 0) {
      output.info('Params:');
      output.keyValue(params, 2);
    } else {
      output.info('Params: none (v1 templates take no caller params — schema is fixed)');
    }

    if (response.example) {
      output.info('Rendered example:');
      console.log(JSON.stringify(response.example, null, 2));
    }
  } catch (err) {
    spinner.fail('Failed to get template');
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404) {
      output.error(`Template not found: ${engine}/${name}/${version}. Run "znvault dynasec templates list" to see available templates.`);
    } else {
      output.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerTemplatesCommands(dynasec: Command): void {
  const templates = dynasec
    .command('templates')
    .description('Browse the fixed, versioned role-creation templates (used by `dynasec role create --template`)')
    .addHelpText('after', `
Examples:
  # List all templates across both engines
  znvault dynasec templates list

  # List only MySQL templates
  znvault dynasec templates list --engine mysql

  # Get the full definition + rendered example for one template
  znvault dynasec templates get mysql/readwrite/1

  # Machine-readable output
  znvault dynasec templates list --json
  znvault dynasec templates get postgresql/readonly/1 --json

Catalog (v1, fixed in server code — no runtime mutation):
  MySQL:      readonly, readwrite, ddl, migrate
  PostgreSQL: readonly, readwrite            (no ddl/migrate — MySQL-only)

Notes:
  - "migrate" (MySQL only) grants EXECUTE on the pre-applied znapi-helpers
    routine bundle; it does NOT create the bundle. If the bundle hasn't been
    applied to the connection yet, role creation still succeeds but returns
    a "bundle_not_applied" warning — apply it first (or after) with:
      znvault dynasec routines apply <connection-or-role> --bundle znapi-helpers --version 1
  - Templates take no caller params in v1 — schema is fixed (the connection's
    database for MySQL, "public" for PostgreSQL). Use
    \`dynasec role create --template <name>\` to actually create a role from
    one of these templates.
`);

  templates
    .command('list')
    .alias('ls')
    .description('List available role templates')
    .option('--engine <engine>', 'Filter by engine (mysql or postgresql)')
    .option('--json', 'Output as JSON')
    .action(listTemplates);

  templates
    .command('get <engine/name/version>')
    .description('Get one template\'s full definition and a rendered example (e.g. mysql/readwrite/1)')
    .option('--json', 'Output as JSON')
    .action(getTemplate);
}
