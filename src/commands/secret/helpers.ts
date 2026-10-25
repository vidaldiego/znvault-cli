// Path: src/commands/secret/helpers.ts

/**
 * Helper functions for secret commands
 */

import type { SecretMetadata } from './types.js';

// Re-export common formatters from centralized location
export { formatDate, formatBytes, formatPaginationInfo } from '../../lib/format-helpers.js';

export function formatType(type: string, subType?: string): string {
  if (subType) return `${type}/${subType}`;
  return type;
}

export function formatTags(tags?: string[]): string {
  if (!tags || tags.length === 0) return '-';
  if (tags.length <= 3) return tags.join(', ');
  return `${tags.slice(0, 2).join(', ')} +${tags.length - 2} more`;
}

export function truncateAlias(alias: string, maxLen = 40): string {
  if (alias.length <= maxLen) return alias;
  return '...' + alias.slice(-(maxLen - 3));
}

export function getDaysUntilExpiry(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  const now = new Date();
  return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatExpiry(expiresAt?: string): string {
  if (!expiresAt) return '-';
  const days = getDaysUntilExpiry(expiresAt);
  if (days === null) return '-';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days <= 7) return `${days}d (!)`;
  if (days <= 30) return `${days}d`;
  return `${days}d`;
}

/** Relationship only: a source link does not prove a received or usable copy. */
export function formatReplication(state: SecretMetadata['replication']): string | null {
  if (!state) return null;
  if (state.role === 'source') {
    if (state.selectedCount === 0) return null;
    const count = state.selectedCount;
    return count !== undefined && Number.isSafeInteger(count) && count > 0 ? `Linked · ${count}` : 'Linked';
  }
  const lifecycle = {active: '', origin_deleted: 'Origin deleted', paused: 'Paused', revoked: 'Revoked', closed: 'Closed', no_copy: 'No copy'}[state.lifecycle ?? 'active'];
  const sync = {current: '', pending: 'Pending', stale: 'Stale', error: 'Error'}[state.syncState ?? 'current'];
  const status = state.hasCopy === false ? 'No copy' : lifecycle || sync;
  return ['Replica', status, 'read only'].filter(Boolean).join(' · ');
}
