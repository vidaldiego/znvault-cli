// Path: src/commands/kms/routing.ts

/**
 * KMS HTTP path routing.
 *
 * The CLI talks to two different KMS surfaces depending on the caller:
 *   - Tenant principal → /v1/kms/keys (tenant from JWT)
 *   - Superadmin → /v1/superadmin/kms/keys (server v1.39.0+)
 *
 * In v4.0.1 the discriminator is the command-registration context, passed
 * explicitly via `asSuperadmin` from each handler. A superadmin running
 * `znvault superadmin kms key list` (no `--tenant`) must route through
 * the admin surface, because `/v1/kms/keys` rejects pure superadmin
 * principals with "Superadmins must use /v1/superadmin/* routes".
 *
 * NOTE: KMS crypto ops (encrypt/decrypt/generate-data-key/re-encrypt) have
 * NO superadmin counterpart by design (separation of duties). Those
 * commands must NOT use this routing; they always target /v1/kms/* and
 * will 403 for superadmin callers.
 */

import { getAuthContext } from '../../lib/auth-context.js';

/**
 * Per-handler runtime flag set by the KMS command registration. The value
 * is captured by a wrapping `withKmsContext()` that runs around each
 * action so that handlers called from `znvault superadmin kms ...` always
 * route to `/v1/superadmin/kms/*`, even when no `--tenant` is supplied.
 *
 * This is a synchronous mutex over the duration of a single handler call;
 * Commander dispatches actions sequentially, so there is no interleaving
 * concern in practice.
 */
let _asSuperadmin = false;

/**
 * Run `fn` with the KMS admin-surface flag set to `value`. Restores the
 * previous value on return.
 */
export async function withKmsContext<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = _asSuperadmin;
  _asSuperadmin = value;
  try {
    return await fn();
  } finally {
    _asSuperadmin = prev;
  }
}

/**
 * Returns true when the request should route through the superadmin KMS
 * surface. Triggered by either:
 *   - The active handler is wrapped with `withKmsContext(true, ...)` because
 *     it was registered under `znvault superadmin kms ...`, or
 *   - An explicit `--tenant` flag from a caller without their own tenant
 *     (i.e. a superadmin JWT) or a tenant user targeting a different tenant.
 */
function useAdminSurface(explicitTenant: string | undefined): boolean {
  if (_asSuperadmin) return true;
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
