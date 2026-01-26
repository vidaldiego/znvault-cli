// Path: src/commands/secret/helpers.ts

/**
 * Helper functions for secret commands
 */

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
