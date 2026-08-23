// Path: src/lib/validation-helpers.ts

/**
 * Shared input validation helpers for CLI commands.
 * These functions validate user input and return validation results
 * with clear error messages.
 */

import { readFileSync, existsSync } from 'node:fs';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  value?: unknown;
}

/**
 * Validate and parse a positive integer
 */
export function validatePositiveInt(
  value: string | undefined,
  fieldName: string,
  options?: { min?: number; max?: number; defaultValue?: number }
): ValidationResult & { value?: number } {
  if (value === undefined || value === '') {
    if (options?.defaultValue !== undefined) {
      return { valid: true, value: options.defaultValue };
    }
    return { valid: false, error: `${fieldName} is required` };
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (parsed < 1) {
    return { valid: false, error: `${fieldName} must be a positive number` };
  }
  if (options?.min !== undefined && parsed < options.min) {
    return { valid: false, error: `${fieldName} must be at least ${options.min}` };
  }
  if (options?.max !== undefined && parsed > options.max) {
    return { valid: false, error: `${fieldName} must be at most ${options.max}` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate and parse a non-negative integer (0 or positive)
 */
export function validateNonNegativeInt(
  value: string | undefined,
  fieldName: string,
  options?: { max?: number; defaultValue?: number }
): ValidationResult & { value?: number } {
  if (value === undefined || value === '') {
    if (options?.defaultValue !== undefined) {
      return { valid: true, value: options.defaultValue };
    }
    return { valid: false, error: `${fieldName} is required` };
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (parsed < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }
  if (options?.max !== undefined && parsed > options.max) {
    return { valid: false, error: `${fieldName} must be at most ${options.max}` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate a URL string
 */
export function validateUrl(
  value: string | undefined,
  fieldName: string,
  options?: { requireHttps?: boolean; allowLocalhost?: boolean }
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  try {
    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: `${fieldName} must use http or https protocol` };
    }

    if (options?.requireHttps && url.protocol !== 'https:') {
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (!options.allowLocalhost || !isLocalhost) {
        return { valid: false, error: `${fieldName} must use https protocol` };
      }
    }

    return { valid: true, value: url.toString() };
  } catch {
    return { valid: false, error: `${fieldName} is not a valid URL` };
  }
}

/**
 * Validate an email address
 */
export function validateEmail(
  value: string | undefined,
  fieldName = 'Email'
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  // RFC 5322 compliant email regex (simplified but robust)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(value)) {
    return { valid: false, error: `${fieldName} is not a valid email address` };
  }

  return { valid: true, value: value.toLowerCase().trim() };
}

/**
 * Validate a port number
 */
export function validatePort(
  value: string | undefined,
  fieldName = 'Port'
): ValidationResult & { value?: number } {
  if (value === undefined || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (parsed < 1 || parsed > 65535) {
    return { valid: false, error: `${fieldName} must be between 1 and 65535` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate a hostname
 */
export function validateHostname(
  value: string | undefined,
  fieldName = 'Hostname'
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  // Allow IP addresses
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(value)) {
    const parts = value.split('.').map(Number);
    if (parts.every(p => p >= 0 && p <= 255)) {
      return { valid: true, value };
    }
    return { valid: false, error: `${fieldName} is not a valid IP address` };
  }

  // Validate hostname
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!hostnameRegex.test(value)) {
    return { valid: false, error: `${fieldName} is not a valid hostname` };
  }

  if (value.length > 253) {
    return { valid: false, error: `${fieldName} exceeds maximum length of 253 characters` };
  }

  return { valid: true, value: value.toLowerCase() };
}

/**
 * Validate a profile name (alphanumeric, hyphens, underscores)
 */
export function validateProfileName(
  value: string | undefined,
  fieldName = 'Profile name'
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const nameRegex = /^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/;
  if (!nameRegex.test(value)) {
    return {
      valid: false,
      error: `${fieldName} must start with a letter and contain only letters, numbers, hyphens, and underscores (max 63 chars)`,
    };
  }

  return { valid: true, value };
}

/**
 * Validate a non-empty string
 */
export function validateNonEmpty(
  value: string | undefined,
  fieldName: string,
  options?: { maxLength?: number; minLength?: number }
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const trimmed = value.trim();

  if (options?.minLength !== undefined && trimmed.length < options.minLength) {
    return { valid: false, error: `${fieldName} must be at least ${options.minLength} characters` };
  }

  if (options?.maxLength !== undefined && trimmed.length > options.maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${options.maxLength} characters` };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate an enum value
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  fieldName: string,
  allowedValues: readonly T[],
  options?: { caseSensitive?: boolean }
): ValidationResult & { value?: T } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const compareValue = options?.caseSensitive ? value : value.toLowerCase();
  const match = allowedValues.find(v =>
    options?.caseSensitive ? v === compareValue : v.toLowerCase() === compareValue
  );

  if (!match) {
    return {
      valid: false,
      error: `${fieldName} must be one of: ${allowedValues.join(', ')}`,
    };
  }

  return { valid: true, value: match };
}

/**
 * Validate a boolean string value
 */
export function validateBoolean(
  value: string | undefined,
  fieldName: string
): ValidationResult & { value?: boolean } {
  if (value === undefined || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === '1') {
    return { valid: true, value: true };
  }
  if (lower === 'false' || lower === 'no' || lower === '0') {
    return { valid: true, value: false };
  }

  return { valid: false, error: `${fieldName} must be true/false, yes/no, or 1/0` };
}

/**
 * Validate a maintenance window format (HH:MM-HH:MM)
 */
export function validateMaintenanceWindow(
  value: string | undefined,
  fieldName = 'Maintenance window'
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const windowRegex = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
  if (!windowRegex.test(value)) {
    return { valid: false, error: `${fieldName} must be in format HH:MM-HH:MM (24-hour format)` };
  }

  return { valid: true, value };
}

/**
 * Validate a timezone string
 */
export function validateTimezone(
  value: string | undefined,
  fieldName = 'Timezone'
): ValidationResult & { value?: string } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  try {
    // Try to create a date formatter with the timezone to validate it
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return { valid: true, value };
  } catch {
    return { valid: false, error: `${fieldName} is not a valid IANA timezone (e.g., America/New_York, UTC)` };
  }
}

/**
 * Validate a JSON string
 */
export function validateJson(
  value: string | undefined,
  fieldName: string
): ValidationResult & { value?: unknown } {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return { valid: true, value: parsed };
  } catch (err) {
    const message = err instanceof SyntaxError ? err.message : 'Invalid JSON';
    return { valid: false, error: `${fieldName}: ${message}` };
  }
}

/**
 * Validate a comma-separated list of values
 */
export function validateCommaSeparatedList(
  value: string | undefined,
  fieldName: string,
  options?: { minItems?: number; maxItems?: number; allowEmpty?: boolean }
): ValidationResult & { value?: string[] } {
  if (!value || value.trim() === '') {
    if (options?.allowEmpty) {
      return { valid: true, value: [] };
    }
    return { valid: false, error: `${fieldName} is required` };
  }

  const items = value.split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (items.length === 0 && !options?.allowEmpty) {
    return { valid: false, error: `${fieldName} must contain at least one item` };
  }

  if (options?.minItems !== undefined && items.length < options.minItems) {
    return { valid: false, error: `${fieldName} must contain at least ${options.minItems} item(s)` };
  }

  if (options?.maxItems !== undefined && items.length > options.maxItems) {
    return { valid: false, error: `${fieldName} must contain at most ${options.maxItems} item(s)` };
  }

  return { valid: true, value: items };
}

/**
 * Read and validate a JSON file
 */
export function readJsonFile(
  filePath: string,
  fieldName: string
): ValidationResult & { value?: unknown } {
  try {
    if (!existsSync(filePath)) {
      return { valid: false, error: `${fieldName}: File not found: ${filePath}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    return validateJson(content, fieldName);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('ENOENT')) {
        return { valid: false, error: `${fieldName}: File not found: ${filePath}` };
      }
      if (err.message.includes('EACCES')) {
        return { valid: false, error: `${fieldName}: Permission denied: ${filePath}` };
      }
      return { valid: false, error: `${fieldName}: ${err.message}` };
    }
    return { valid: false, error: `${fieldName}: Failed to read file` };
  }
}

/**
 * Validate password meets policy requirements
 */
export function validatePassword(
  value: string | undefined,
  fieldName = 'Password',
  options?: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumbers?: boolean;
    requireSpecial?: boolean;
  }
): ValidationResult & { value?: string } {
  if (!value) {
    return { valid: false, error: `${fieldName} is required` };
  }

  const minLength = options?.minLength ?? 12;
  const requireUppercase = options?.requireUppercase ?? true;
  const requireLowercase = options?.requireLowercase ?? true;
  const requireNumbers = options?.requireNumbers ?? true;
  const requireSpecial = options?.requireSpecial ?? true;

  const errors: string[] = [];

  if (value.length < minLength) {
    errors.push(`at least ${minLength} characters`);
  }
  if (requireUppercase && !/[A-Z]/.test(value)) {
    errors.push('an uppercase letter');
  }
  if (requireLowercase && !/[a-z]/.test(value)) {
    errors.push('a lowercase letter');
  }
  if (requireNumbers && !/\d/.test(value)) {
    errors.push('a number');
  }
  if (requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value)) {
    errors.push('a special character');
  }

  if (errors.length > 0) {
    return { valid: false, error: `${fieldName} must contain ${errors.join(', ')}` };
  }

  return { valid: true, value };
}
