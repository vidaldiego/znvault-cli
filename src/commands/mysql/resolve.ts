// src/commands/mysql/resolve.ts

/**
 * Resolve a target (connection name/id or alias) + optional role to concrete IDs.
 *
 * This is used by `znvault mysql exec/connect` to turn the user-supplied target
 * and --role option into the { connectionId, roleId } pair needed by the broker.
 */

import { client } from '../../lib/client.js';
import type { DbConnection, DbRole } from '../dynamic-secrets/types.js';
import { getAlias } from './alias.js';

/**
 * Resolve a connection name or id to a concrete connection id.
 *
 * Strategy (avoids a guaranteed 404 round-trip on the common name case):
 *   - If `target` looks like a connection id (starts with "dbc_"), try GET by id
 *     first; if that 404s, fall back to listing and matching by name.
 *   - Otherwise (target is a friendly name), list all connections and match by
 *     name first; if not found, try GET by id as a last resort.
 *   - If neither resolves, throw a clear "not found (by id or name)" error.
 *
 * Connection names are unique per tenant, so a name match is unambiguous.
 * If somehow multiple entries share a name, the first match is used.
 */
async function resolveConnectionId(target: string): Promise<string> {
  const looksLikeId = target.startsWith('dbc_');

  if (looksLikeId) {
    // Try direct GET by id first.
    try {
      const conn = await client.get<DbConnection>(`/v1/dynamic-secrets/connections/${target}`);
      return conn.id;
    } catch {
      // Fall through to list-by-name.
    }
  }

  // List all connections and match by name.
  const connections = await client.get<DbConnection[]>('/v1/dynamic-secrets/connections');
  const byName = connections.find((c) => c.name === target);
  if (byName !== undefined) {
    return byName.id;
  }

  if (!looksLikeId) {
    // Not found by name; try GET by id as a last resort.
    try {
      const conn = await client.get<DbConnection>(`/v1/dynamic-secrets/connections/${target}`);
      return conn.id;
    } catch {
      // Fall through to error.
    }
  }

  throw new Error(
    `Connection '${target}' not found (by id or name). ` +
      `Run 'znvault dynamic-secrets connections list' to see available connections.`,
  );
}

/**
 * Resolve `target` (a connection name/id OR an alias) plus an optional role
 * name/id into concrete IDs.
 *
 * Resolution rules:
 *   1. If `target` matches a saved alias, expand to { connection, role }.
 *      Validate both still exist; if not, throw a "dangling alias" error (F13).
 *   2. Otherwise treat `target` as a connection name/id and fetch it.
 *   3. Resolve the role:
 *      - If a role name/id is given, find it in the connection's role list.
 *      - If no role given and the connection has exactly one role, use it.
 *      - Otherwise throw an error instructing the user to pass --role.
 */
export async function resolveTarget(
  target: string,
  roleOpt?: string,
): Promise<{ connectionId: string; roleId: string }> {
  const alias = getAlias(target);

  if (alias !== undefined) {
    // Alias path — validate that connection and role still exist.
    const connectionTarget = alias.connection;
    const roleTarget = alias.role;

    let connectionId: string;
    try {
      connectionId = await resolveConnectionId(connectionTarget);
    } catch {
      throw new Error(
        `Dangling alias '${target}': connection '${connectionTarget}' no longer exists`,
      );
    }

    const roles = await client.get<DbRole[]>(
      `/v1/dynamic-secrets/connections/${connectionId}/roles`,
    );
    const role = roles.find((r) => r.name === roleTarget || r.id === roleTarget);
    if (role === undefined) {
      throw new Error(
        `Dangling alias '${target}': role '${roleTarget}' no longer exists on connection '${connectionTarget}'`,
      );
    }

    return { connectionId, roleId: role.id };
  }

  // Direct connection path.
  const connectionId = await resolveConnectionId(target);

  const roles = await client.get<DbRole[]>(
    `/v1/dynamic-secrets/connections/${connectionId}/roles`,
  );

  if (roleOpt !== undefined) {
    const role = roles.find((r) => r.name === roleOpt || r.id === roleOpt);
    if (role === undefined) {
      throw new Error(
        `Role '${roleOpt}' not found on connection '${target}'. ` +
          `Available: ${roles.map((r) => r.name).join(', ') || '(none)'}`,
      );
    }
    return { connectionId, roleId: role.id };
  }

  // No role given — require exactly one.
  if (roles.length === 1) {
    return { connectionId, roleId: roles[0].id };
  }

  if (roles.length === 0) {
    throw new Error(
      `Connection '${target}' has no roles. Create one first, then pass --role <name>.`,
    );
  }

  throw new Error(
    `Connection '${target}' has ${roles.length.toString()} roles. ` +
      `Pass --role <name> to select one: ${roles.map((r) => r.name).join(', ')}`,
  );
}
