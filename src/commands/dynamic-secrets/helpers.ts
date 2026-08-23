// Path: src/commands/dynamic-secrets/helpers.ts

/**
 * Helper functions for dynamic secrets commands
 */

import * as output from '../../lib/output.js';
import { formatTtl as formatTtlBase } from '../../lib/format-helpers.js';

// Re-export formatDate from centralized location
export { formatDate } from '../../lib/format-helpers.js';

// Alias formatTtl as formatDuration for semantic clarity in this context
export const formatDuration = formatTtlBase;

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

export function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'inherit';
  return formatTtlBase(seconds);
}
