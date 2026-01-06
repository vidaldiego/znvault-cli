// Path: znvault-cli/src/commands/backup/helpers.ts
// Helper functions for backup CLI commands

export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'Pending',
    'completed': 'Completed',
    'failed': 'Failed',
    'verified': 'Verified',
  };
  return statusMap[status] || status;
}

export function formatAge(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  return 'Just now';
}

export function formatInterval(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${ms}ms`;
}

export function parseInterval(interval: string): number {
  // Support formats: 1h, 30m, 1h30m, 3600000 (ms)
  const regex = /^(?:(\d+)h)?(?:(\d+)m)?$/i;
  const match = regex.exec(interval);
  if (match !== null) {
    // Capture groups are undefined when not matched (runtime behavior)
    const hoursStr = match[1] as string | undefined;
    const minutesStr = match[2] as string | undefined;
    // Both groups are optional - at least one must be present for a valid interval
    if (hoursStr ?? minutesStr) {
      const hours = hoursStr ? parseInt(hoursStr, 10) : 0;
      const minutes = minutesStr ? parseInt(minutesStr, 10) : 0;
      return (hours * 60 + minutes) * 60 * 1000;
    }
  }
  // Try parsing as milliseconds
  const ms = parseInt(interval, 10);
  if (!isNaN(ms)) return ms;
  throw new Error('Invalid interval format. Use: 1h, 30m, 1h30m, or milliseconds');
}
