// Path: src/lib/debug.ts

/**
 * Debug logging utility for silent catch blocks
 *
 * Only logs when ZNVAULT_DEBUG=1 or ZNVAULT_DEBUG=true environment variable is set.
 * This allows tracing silenced errors without affecting production performance.
 */

const isDebugEnabled = (): boolean => {
  const debug = process.env.ZNVAULT_DEBUG;
  return debug === '1' || debug === 'true';
};

/**
 * Log a debug message (only when ZNVAULT_DEBUG is enabled)
 */
export function debug(context: string, message: string, error?: unknown): void {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString();
  const errorInfo = error instanceof Error
    ? `: ${error.message}`
    : error !== undefined
      ? `: ${String(error)}`
      : '';

  console.error(`[DEBUG ${timestamp}] [${context}] ${message}${errorInfo}`);
}

/**
 * Log a silenced error (only when ZNVAULT_DEBUG is enabled)
 * Use this in catch blocks that intentionally ignore errors
 */
export function debugSilencedError(context: string, operation: string, error: unknown): void {
  if (!isDebugEnabled()) return;

  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[DEBUG ${timestamp}] [${context}] Silenced error in ${operation}: ${errorMessage}`);
  if (stack) {
    console.error(`[DEBUG ${timestamp}] [${context}] Stack: ${stack.split('\n').slice(1, 4).join('\n')}`);
  }
}

/**
 * Create a scoped debug logger for a specific module
 */
export function createDebugLogger(context: string): {
  log: (message: string, error?: unknown) => void;
  silenced: (operation: string, error: unknown) => void;
} {
  return {
    log: (message: string, error?: unknown) => debug(context, message, error),
    silenced: (operation: string, error: unknown) => debugSilencedError(context, operation, error),
  };
}
