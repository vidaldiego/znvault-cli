// src/commands/mysql/alias.ts

/**
 * Per-profile MySQL alias store.
 *
 * Aliases map a short name (e.g. "staging-rw") to a dynamic-secrets connection
 * name and role name so that `znvault mysql exec staging-rw` can be used instead
 * of spelling out the full --connection / --role flags every time.
 *
 * Aliases are stored under the active profile in the CLI config:
 *   profile.mysqlAliases: Record<string, { connection: string; role: string }>
 */

import { getCurrentProfile, saveProfile } from '../../lib/config/profile.js';
import { getActiveProfileName } from '../../lib/config/profile.js';

/**
 * Add or overwrite a MySQL alias in the active profile.
 */
export function addAlias(name: string, connection: string, role: string): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  const aliases = profile.mysqlAliases ?? {};
  aliases[name] = { connection, role };
  saveProfile(profileName, { ...profile, mysqlAliases: aliases });
}

/**
 * Get a MySQL alias from the active profile.
 * Returns undefined if the alias does not exist.
 */
export function getAlias(name: string): { connection: string; role: string } | undefined {
  const profile = getCurrentProfile();
  return profile.mysqlAliases?.[name];
}

/**
 * List all MySQL aliases in the active profile.
 */
export function listAliases(): Array<{ name: string; connection: string; role: string }> {
  const profile = getCurrentProfile();
  const aliases = profile.mysqlAliases ?? {};
  return Object.entries(aliases).map(([name, { connection, role }]) => ({
    name,
    connection,
    role,
  }));
}

/**
 * Remove a MySQL alias from the active profile.
 * No-op if the alias does not exist.
 */
export function removeAlias(name: string): void {
  const profileName = getActiveProfileName();
  const profile = getCurrentProfile();
  const aliases = profile.mysqlAliases ?? {};
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete aliases[name];
  saveProfile(profileName, { ...profile, mysqlAliases: aliases });
}
