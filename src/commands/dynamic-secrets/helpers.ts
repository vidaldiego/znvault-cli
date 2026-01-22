// Path: src/commands/dynamic-secrets/helpers.ts

/**
 * Helper functions for dynamic secrets commands
 */

import * as output from '../../lib/output.js';

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatStatus(status: string): string {
  switch (status) {
    case 'ACTIVE': return output.isPlainMode() ? 'ACTIVE' : '\x1b[32mACTIVE\x1b[0m';
    case 'DISABLED': return output.isPlainMode() ? 'DISABLED' : '\x1b[33mDISABLED\x1b[0m';
    case 'FAILED': return output.isPlainMode() ? 'FAILED' : '\x1b[31mFAILED\x1b[0m';
    case 'TESTING': return output.isPlainMode() ? 'TESTING' : '\x1b[36mTESTING\x1b[0m';
    case 'EXPIRED': return output.isPlainMode() ? 'EXPIRED' : '\x1b[33mEXPIRED\x1b[0m';
    case 'REVOKED': return output.isPlainMode() ? 'REVOKED' : '\x1b[31mREVOKED\x1b[0m';
    default: return status;
  }
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

export function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'inherit';
  return formatDuration(seconds);
}
