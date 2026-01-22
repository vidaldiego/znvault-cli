// Path: src/commands/secret/resolve.ts

/**
 * Secret ID/alias resolution utilities
 */

import { client } from '../../lib/client.js';
import type { SecretMetadata } from './types.js';

/**
 * Check if a string looks like a UUID
 */
export function isUUID(str: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str);
}

/**
 * Resolve a secret identifier to a UUID.
 * Supports formats:
 * - UUID: pass through directly
 * - alias:path: resolve via /v1/secrets/alias/:alias (tenant from JWT)
 * - path/to/secret: resolve via /v1/secrets/alias/:alias (tenant from JWT)
 * - simple-name: resolve via /v1/secrets/alias/:alias (tenant from JWT)
 *
 * Note: The alias is the full path (e.g., "zn-admin/config"), NOT tenant/alias.
 * Tenant is always derived from the authenticated user's JWT.
 */
export async function resolveSecretId(idOrAlias: string): Promise<string> {
  // Already a UUID - pass through
  if (isUUID(idOrAlias)) {
    return idOrAlias;
  }

  // Strip optional "alias:" prefix
  const alias = idOrAlias.startsWith('alias:')
    ? idOrAlias.slice(6)
    : idOrAlias;

  // Resolve alias to UUID via API (tenant derived from JWT)
  const metadata = await client.get<SecretMetadata>(`/v1/secrets/alias/${encodeURIComponent(alias)}`);
  return metadata.id;
}
