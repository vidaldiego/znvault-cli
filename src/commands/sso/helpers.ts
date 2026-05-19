// Path: src/commands/sso/helpers.ts

/**
 * SSO command helper functions
 */

// Re-export common formatters from centralized location
export { formatTtl } from '../../lib/format-helpers.js';

/**
 * Per-handler runtime flag set by the SSO command registration. Mirrors
 * the pattern used in `commands/kms/routing.ts`: handlers registered under
 * `znvault superadmin sso ...` are wrapped in `withSsoContext(true, ...)`
 * so that read paths route to `/v1/superadmin/sso/*` instead of the
 * tenant-scoped `/v1/sso/*` (which rejects pure superadmin principals).
 *
 * Write paths (create/update/delete/rotate-secret) have no admin
 * counterpart today; calling them from `znvault superadmin sso ...`
 * will hit `/v1/superadmin/sso/<resource>` which returns 404, surfacing
 * the unsupported state to the operator. Read paths (list/get) are mapped
 * to their admin equivalents.
 */
let _asSuperadmin = false;

export async function withSsoContext<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = _asSuperadmin;
  _asSuperadmin = value;
  try {
    return await fn();
  } finally {
    _asSuperadmin = prev;
  }
}

/**
 * Build the base path for SSO app routes. Returns the admin namespace
 * when the active handler was registered under `superadmin sso`.
 */
export function ssoAppsBase(): string {
  return _asSuperadmin ? '/v1/superadmin/sso/apps' : '/v1/sso/apps';
}

/**
 * Build tenant query string. In admin mode this is always required.
 */
export function buildTenantQuery(tenant?: string): string {
  return tenant ? `?tenantId=${encodeURIComponent(tenant)}` : '';
}
