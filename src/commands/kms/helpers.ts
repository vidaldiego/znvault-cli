// Path: src/commands/kms/helpers.ts

/**
 * KMS command helper functions
 */

import { createDebugLogger } from '../../lib/debug.js';

// Re-export common formatters from centralized location
export { formatDate, truncateId, formatPaginationInfo } from '../../lib/format-helpers.js';

const log = createDebugLogger('kms-helpers');

/**
 * Format key state for display
 */
export function formatKeyState(state: string): string {
  const stateMap: Record<string, string> = {
    'Enabled': 'Enabled',
    'Disabled': 'Disabled',
    'PendingDeletion': 'Pending Deletion',
    'PendingImport': 'Pending Import',
  };
  return stateMap[state] || state;
}

/**
 * Parse encryption context from string (JSON or key=value,... format)
 */
export function parseContext(contextStr?: string): Record<string, string> {
  if (!contextStr) return {};
  try {
    return JSON.parse(contextStr) as Record<string, string>;
  } catch (err) {
    log.silenced('parseContext:parseJson', err);
    // Try key=value format
    const context: Record<string, string> = {};
    const pairs = contextStr.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        context[key.trim()] = value.trim();
      }
    }
    return context;
  }
}
