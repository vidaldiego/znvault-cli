// Path: src/lib/command-error-handler.ts

/**
 * Centralized command error handling utilities.
 * Provides consistent error handling patterns across all CLI commands.
 */

import * as output from './output.js';

/**
 * Options for error handling
 */
export interface ErrorHandlerOptions {
  /** Optional spinner to fail with message */
  spinner?: ReturnType<typeof output.spinner>;
  /** Exit code (default: 1) */
  exitCode?: number;
  /** Whether to exit process (default: true) */
  exit?: boolean;
  /** Whether to log the error (default: true) */
  log?: boolean;
}

/**
 * Extract error message from unknown error value
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Handle command error with consistent behavior:
 * - Fail spinner if provided
 * - Log error message
 * - Exit process (by default)
 *
 * @param error - The error that occurred
 * @param message - User-friendly message to display
 * @param options - Optional configuration
 * @returns never (exits process) unless options.exit is false
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   handleCommandError(error, 'Failed to complete operation', { spinner });
 * }
 * ```
 */
export function handleCommandError(
  error: unknown,
  message: string,
  options?: ErrorHandlerOptions
): never;
export function handleCommandError(
  error: unknown,
  message: string,
  options: ErrorHandlerOptions & { exit: false }
): void;
export function handleCommandError(
  error: unknown,
  message: string,
  options: ErrorHandlerOptions = {}
): void | never {
  const { spinner, exitCode = 1, exit = true, log = true } = options;

  // Fail spinner with message if provided
  if (spinner) {
    spinner.fail(message);
  }

  // Log the actual error message
  if (log) {
    output.error(getErrorMessage(error));
  }

  // Exit process unless explicitly disabled
  if (exit) {
    process.exit(exitCode);
  }
}

/**
 * Wrap an async command action with error handling
 *
 * @param action - The async command action to wrap
 * @param errorMessage - Message to display on error
 * @returns Wrapped action function
 *
 * @example
 * ```typescript
 * cmd.action(withErrorHandler(async (options) => {
 *   await performOperation(options);
 * }, 'Operation failed'));
 * ```
 */
export function withErrorHandler<T extends unknown[]>(
  action: (...args: T) => Promise<void>,
  errorMessage: string
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await action(...args);
    } catch (error) {
      handleCommandError(error, errorMessage);
    }
  };
}

/**
 * Create an error handler for a specific command
 * Useful when you need to reuse the same error handling across multiple places
 *
 * @param message - Default error message
 * @param options - Default options
 * @returns Error handler function
 *
 * @example
 * ```typescript
 * const handleSecretError = createErrorHandler('Secret operation failed');
 *
 * try {
 *   await operation1();
 * } catch (error) {
 *   handleSecretError(error);
 * }
 * ```
 */
export function createErrorHandler(
  message: string,
  options?: ErrorHandlerOptions
): (error: unknown, overrideMessage?: string, overrideOptions?: ErrorHandlerOptions) => never {
  return (error: unknown, overrideMessage?: string, overrideOptions?: ErrorHandlerOptions): never => {
    handleCommandError(
      error,
      overrideMessage ?? message,
      { ...options, ...overrideOptions }
    );
    // This line is never reached, but TypeScript needs it for the return type
    throw error;
  };
}

/**
 * Assert condition and exit with error if false
 *
 * @param condition - Condition to check
 * @param message - Error message if condition is false
 * @param exitCode - Exit code (default: 1)
 */
export function assertOrExit(
  condition: boolean,
  message: string,
  exitCode = 1
): asserts condition {
  if (!condition) {
    output.error(message);
    process.exit(exitCode);
  }
}

/**
 * Require a value to be defined, exit with error if undefined/null
 *
 * @param value - Value to check
 * @param message - Error message if value is undefined
 * @param exitCode - Exit code (default: 1)
 * @returns The value if defined
 */
export function requireOrExit<T>(
  value: T | undefined | null,
  message: string,
  exitCode = 1
): T {
  if (value === undefined || value === null) {
    output.error(message);
    process.exit(exitCode);
  }
  return value;
}
