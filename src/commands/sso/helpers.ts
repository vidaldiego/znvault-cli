// Path: src/commands/sso/helpers.ts

/**
 * SSO command helper functions
 */

// Re-export common formatters from centralized location
export { formatTtl } from '../../lib/format-helpers.js';

/**
 * Build tenant query string
 */
export function buildTenantQuery(tenant?: string): string {
  return tenant ? `?tenantId=${encodeURIComponent(tenant)}` : '';
}
