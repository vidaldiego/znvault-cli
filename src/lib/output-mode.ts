// Path: znvault-cli/src/lib/output-mode.ts
/**
 * Output Mode Detection Module
 *
 * Determines whether to use TUI (rich) or plain text output based on:
 * - TTY detection
 * - CI environment
 * - --plain flag
 * - ZNVAULT_PLAIN_OUTPUT env var
 */

export type OutputMode = 'tui' | 'plain';

// Global state for output mode override
let modeOverride: OutputMode | null = null;

/**
 * Set the output mode override (called from --plain flag handler)
 */
export function setOutputMode(mode: OutputMode): void {
  modeOverride = mode;
}

/**
 * Get the current output mode
 */
export function getOutputMode(): OutputMode {
  // Explicit override takes precedence
  if (modeOverride !== null) {
    return modeOverride;
  }

  // Environment variable override
  if (process.env.ZNVAULT_PLAIN_OUTPUT === 'true' || process.env.ZNVAULT_PLAIN_OUTPUT === '1') {
    return 'plain';
  }

  // CI environments should use plain output
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return 'plain';
  }

  // Common CI environment variables
  const ciEnvVars = [
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'JENKINS_URL',
    'TRAVIS',
    'BUILDKITE',
    'AZURE_PIPELINES',
    'TF_BUILD',
    'TEAMCITY_VERSION',
  ];

  for (const envVar of ciEnvVars) {
    if (process.env[envVar]) {
      return 'plain';
    }
  }

  // Check if stdout is a TTY
  if (!process.stdout.isTTY) {
    return 'plain';
  }

  // Check if stdin is a TTY (for piped input)
  if (!process.stdin.isTTY) {
    return 'plain';
  }

  // Default to TUI for interactive terminals
  return 'tui';
}

/**
 * Check if output should be plain
 */
export function isPlainMode(): boolean {
  return getOutputMode() === 'plain';
}

/**
 * Check if TUI mode is enabled
 */
export function isTuiMode(): boolean {
  return getOutputMode() === 'tui';
}

/**
 * Reset mode override (useful for testing)
 */
export function resetOutputMode(): void {
  modeOverride = null;
}
