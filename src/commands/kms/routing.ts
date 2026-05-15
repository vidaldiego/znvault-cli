// Path: src/commands/kms/routing.ts

/**
 * KMS HTTP path routing.
 *
 * The CLI talks to two different KMS surfaces depending on the caller:
 *   - Tenant principal (or no --tenant flag) → /v1/kms/keys (tenant from JWT)
 *   - Superadmin acting cross-tenant (--tenant present and differs from
 *     the caller's own tenant) → /v1/superadmin/kms/keys (server v1.39.0+)
 *
 * NOTE: KMS crypto ops (encrypt/decrypt/generate-data-key/re-encrypt) have
 * NO superadmin counterpart by design (separation of duties). Those
 * commands must NOT use this routing; they always target /v1/kms/* and
 * will 403 for superadmin callers.
 */

import { getAuthContext } from '../../lib/auth-context.js';

/**
 * Returns true when the explicit --tenant flag indicates a cross-tenant
 * operation that should route through the superadmin surface.
 */
function useAdminSurface(explicitTenant: string | undefined): boolean {
  if (explicitTenant === undefined) return false;
  const ctx = getAuthContext();
  // Superadmins have no tenantId in their JWT; any --tenant is cross-tenant.
  if (!ctx.tenantId) return true;
  // Tenant users acting on their own tenant: stay on tenant route.
  return explicitTenant !== ctx.tenantId;
}

export function kmsKeysPath(explicitTenant: string | undefined, suffix = ''): string {
  const base = useAdminSurface(explicitTenant) ? '/v1/superadmin/kms/keys' : '/v1/kms/keys';
  return base + suffix;
}

export function kmsKeysQuery(
  explicitTenant: string | undefined,
  extra: Record<string, string | undefined> = {}
): string {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) params[k] = v;
  if (useAdminSurface(explicitTenant) && explicitTenant) {
    params.tenantId = explicitTenant;
  }
  const qs = new URLSearchParams(params).toString();
  return qs ? `?${qs}` : '';
}

export function kmsIsAdminCall(explicitTenant: string | undefined): boolean {
  return useAdminSurface(explicitTenant);
}
