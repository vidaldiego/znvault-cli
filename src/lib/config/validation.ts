// Path: src/lib/config/validation.ts

/**
 * Environment variable validation
 *
 * Validates environment variables on access and provides clear error messages
 * for misconfiguration.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate environment variables and return any issues
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate ZNVAULT_URL if set
  const url = process.env.ZNVAULT_URL;
  if (url !== undefined) {
    if (url.trim() === '') {
      errors.push('ZNVAULT_URL is set but empty');
    } else if (!isValidUrl(url)) {
      errors.push(`ZNVAULT_URL is not a valid URL: ${url}`);
    }
  }

  // Validate ZNVAULT_TIMEOUT if set
  const timeout = process.env.ZNVAULT_TIMEOUT;
  if (timeout !== undefined) {
    const timeoutNum = parseInt(timeout, 10);
    if (isNaN(timeoutNum) || timeoutNum <= 0) {
      errors.push(`ZNVAULT_TIMEOUT must be a positive number: ${timeout}`);
    } else if (timeoutNum < 1000) {
      warnings.push(`ZNVAULT_TIMEOUT is very low (${timeoutNum}ms), requests may timeout`);
    }
  }

  // Validate ZNVAULT_USERNAME/PASSWORD pair
  const username = process.env.ZNVAULT_USERNAME;
  const password = process.env.ZNVAULT_PASSWORD;
  if (username !== undefined && password === undefined) {
    errors.push('ZNVAULT_USERNAME is set but ZNVAULT_PASSWORD is missing');
  }
  if (password !== undefined && username === undefined) {
    errors.push('ZNVAULT_PASSWORD is set but ZNVAULT_USERNAME is missing');
  }
  if (username?.trim() === '') {
    errors.push('ZNVAULT_USERNAME is set but empty');
  }
  if (password !== undefined && password === '') {
    warnings.push('ZNVAULT_PASSWORD is set to an empty string');
  }

  // Validate ZNVAULT_API_KEY format if set
  const apiKey = process.env.ZNVAULT_API_KEY;
  if (apiKey !== undefined) {
    if (apiKey.trim() === '') {
      errors.push('ZNVAULT_API_KEY is set but empty');
    } else if (!apiKey.startsWith('znv_')) {
      warnings.push('ZNVAULT_API_KEY does not start with "znv_" prefix - may be invalid');
    }
  }

  // Warn about conflicting authentication methods
  if (apiKey && (username || password)) {
    warnings.push('Both ZNVAULT_API_KEY and ZNVAULT_USERNAME/PASSWORD are set - API key takes precedence');
  }

  // Validate ZNVAULT_INSECURE if set
  const insecure = process.env.ZNVAULT_INSECURE;
  if (insecure !== undefined && insecure !== 'true' && insecure !== 'false') {
    warnings.push(`ZNVAULT_INSECURE should be "true" or "false", got: ${insecure}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate environment and throw if critical errors found
 */
export function assertValidEnvironment(): void {
  const result = validateEnvironment();

  if (!result.valid) {
    throw new Error(
      'Invalid environment configuration:\n' +
      result.errors.map(e => `  - ${e}`).join('\n')
    );
  }
}

/**
 * Get validated environment credentials
 * Returns undefined if not set, throws if set but invalid
 */
export function getValidatedEnvCredentials(): { username: string; password: string } | undefined {
  const username = process.env.ZNVAULT_USERNAME;
  const password = process.env.ZNVAULT_PASSWORD;

  // Not set at all - return undefined
  if (username === undefined && password === undefined) {
    return undefined;
  }

  // Partially set - error
  if (username === undefined) {
    throw new Error('ZNVAULT_PASSWORD is set but ZNVAULT_USERNAME is missing');
  }
  if (password === undefined) {
    throw new Error('ZNVAULT_USERNAME is set but ZNVAULT_PASSWORD is missing');
  }

  // Both set but username is empty
  if (username.trim() === '') {
    throw new Error('ZNVAULT_USERNAME is set but empty');
  }

  return { username, password };
}

/**
 * Get validated API key from environment
 * Returns undefined if not set, throws if set but invalid
 */
export function getValidatedApiKey(): string | undefined {
  const apiKey = process.env.ZNVAULT_API_KEY;

  if (apiKey === undefined) {
    return undefined;
  }

  if (apiKey.trim() === '') {
    throw new Error('ZNVAULT_API_KEY is set but empty');
  }

  return apiKey;
}

/**
 * Get validated URL from environment
 * Returns undefined if not set, throws if set but invalid
 */
export function getValidatedUrl(): string | undefined {
  const url = process.env.ZNVAULT_URL;

  if (url === undefined) {
    return undefined;
  }

  if (url.trim() === '') {
    throw new Error('ZNVAULT_URL is set but empty');
  }

  if (!isValidUrl(url)) {
    throw new Error(`ZNVAULT_URL is not a valid URL: ${url}`);
  }

  return url;
}
