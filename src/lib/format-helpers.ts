// Path: src/lib/format-helpers.ts

/**
 * Shared format helper functions for consistent output formatting across CLI commands.
 * These functions do NOT depend on output mode (plain/TUI) - they return plain strings.
 * For mode-aware formatting with colors, use output.ts functions.
 */

/**
 * Format a date string for display
 * Returns '-' for null/undefined values
 */
export function formatDate(dateStr: string | Date | undefined | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === '') {
    return '-';
  }
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) {
      return String(dateStr);
    }
    return date.toLocaleString();
  } catch {
    return String(dateStr);
  }
}

/**
 * Format a date as ISO date only (YYYY-MM-DD)
 */
export function formatDateShort(dateStr: string | Date | undefined | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === '') {
    return '-';
  }
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) {
      return String(dateStr);
    }
    return date.toISOString().split('T')[0];
  } catch {
    return String(dateStr);
  }
}

/**
 * Format byte count as human-readable string (e.g., "1.5 KB", "2.3 MB")
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) {
    return '-';
  }
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[Math.min(i, units.length - 1)]}`;
}

/**
 * Format duration from milliseconds to human-readable string
 */
export function formatDurationMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return '-';
  }
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format duration from seconds to human-readable string
 * Examples: 86400 -> "1d", 3600 -> "1h", 90 -> "1m 30s"
 */
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) {
    return '-';
  }
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Convert seconds to compact human-readable duration (e.g., 86400 -> "24h")
 * Prefers hours for durations up to 7 days, then uses days.
 * Used for API key rotation intervals and similar settings.
 */
export function formatSecondsToHuman(seconds: number): string {
  const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
  const DAY_IN_SECONDS = 24 * 60 * 60;
  const HOUR_IN_SECONDS = 60 * 60;
  const MINUTE_IN_SECONDS = 60;

  // Use days only for 7+ days and evenly divisible
  if (seconds >= WEEK_IN_SECONDS && seconds % DAY_IN_SECONDS === 0) {
    return `${seconds / DAY_IN_SECONDS}d`;
  }
  // Use hours if evenly divisible by hours
  if (seconds >= HOUR_IN_SECONDS && seconds % HOUR_IN_SECONDS === 0) {
    return `${seconds / HOUR_IN_SECONDS}h`;
  }
  // Use minutes if evenly divisible
  if (seconds >= MINUTE_IN_SECONDS && seconds % MINUTE_IN_SECONDS === 0) {
    return `${seconds / MINUTE_IN_SECONDS}m`;
  }
  return `${seconds}s`;
}

/**
 * Format expiry date relative to now
 * Returns strings like "in 30 days", "expired 2 days ago", etc.
 */
export function formatExpiry(expiresAt: string | undefined | null): string {
  if (!expiresAt) return '-';

  try {
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return expiresAt;

    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return `expired ${Math.abs(diffDays)}d ago`;
    } else if (diffDays === 0) {
      return 'expires today';
    } else if (diffDays === 1) {
      return 'expires tomorrow';
    } else if (diffDays <= 30) {
      return `in ${diffDays}d`;
    } else {
      return formatDateShort(expiresAt);
    }
  } catch {
    return expiresAt;
  }
}

/**
 * Format relative time (e.g., "5m ago", "2h ago", "3d ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 */
export function truncateString(str: string | undefined | null, maxLength: number): string {
  if (!str) return '-';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format a string array as comma-separated list
 */
export function formatList(items: string[] | undefined | null, maxItems = 5): string {
  if (!items || items.length === 0) return '-';
  if (items.length <= maxItems) return items.join(', ');
  return `${items.slice(0, maxItems).join(', ')} (+${items.length - maxItems} more)`;
}

/**
 * Format a boolean as yes/no
 */
export function formatBoolean(value: boolean | undefined | null): string {
  if (value === undefined || value === null) return '-';
  return value ? 'yes' : 'no';
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  return value.toLocaleString();
}

/**
 * Format a percentage value
 */
export function formatPercent(value: number | undefined | null, decimals = 1): string {
  if (value === undefined || value === null) return '-';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format TTL in seconds as compact human-readable string
 * Examples: 3600 -> "1h", 86400 -> "1d", 1800 -> "30m"
 * Used for SSH certificates, KMS keys, tokens, etc.
 */
export function formatTtl(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Parse TTL string to seconds
 * Examples: "8h" -> 28800, "1d" -> 86400, "30m" -> 1800
 */
export function parseTtl(ttl: string): number {
  const match = /^(\d+)([smhd])?$/i.exec(ttl);
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}. Use format like 8h, 30m, 1d, or 3600`);
  }
  const value = parseInt(match[1]);
  const unit = match[2]?.toLowerCase() ?? 's';
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
}

/**
 * Truncate an ID or alias for display
 */
export function truncateId(id: string | undefined | null, maxLen = 12): string {
  if (!id) return '-';
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 2) + '..';
}

/**
 * Truncate an ID to 8 characters (common table display pattern)
 * Example: "abc123def456" -> "abc123de"
 */
export function shortId(id: string | undefined | null): string {
  if (!id) return '-';
  if (id.length <= 8) return id;
  return id.substring(0, 8);
}

/**
 * Format active/enabled status for display
 * Example: true -> "Enabled", false -> "Disabled"
 */
export function formatActiveStatus(isActive: boolean | undefined | null): string {
  if (isActive === undefined || isActive === null) return '-';
  return isActive ? 'Enabled' : 'Disabled';
}

/**
 * Format pagination info for list commands
 * Examples:
 *   - "Total: 50 item(s)" (when no more items)
 *   - "Total: 50 item(s) (more available)" (when hasMore)
 *   - "Showing 20 of 50" (alternative format)
 */
export function formatPaginationInfo(
  pagination: { total: number; hasMore: boolean },
  itemName = 'item'
): string {
  const suffix = pagination.hasMore ? ' (more available)' : '';
  return `Total: ${pagination.total} ${itemName}(s)${suffix}`;
}

/**
 * Format pagination info in "Showing X of Y" style
 */
export function formatPaginationShowing(
  shown: number,
  pagination: { total: number; hasMore: boolean }
): string {
  if (pagination.hasMore) {
    return `Showing ${shown} of ${pagination.total}`;
  }
  return `Total: ${pagination.total}`;
}
