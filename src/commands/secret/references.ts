/**
 * Client-side validation and construction helpers for Secret References.
 *
 * NOTE: This module deliberately contains NO `${ref:...}` token expander.
 * Reference resolution is performed server-side at decrypt time; the CLI only
 * validates the token-alias / field-path grammar (a typo-catcher — the server
 * remains the authority) and builds the structured link pointer.
 */

/** Structured link-secret payload: a pointer to another secret. */
export interface LinkData {
  ref: string;
  field?: string;
}

/** Result of a client-side validation check. */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Max length of a token-alias (matches the server's TOKEN_ALIAS_MAX). */
export const TOKEN_ALIAS_MAX = 512;

/** Max length of a field dot-path (matches the interpolation-token field cap). */
export const FIELD_PATH_MAX = 256;

// Must start with an alphanumeric or underscore (never `-`, so bash
// `${ref:-default}` is never a token), then allow `. _ - / A-Z a-z 0-9`.
const TOKEN_ALIAS_RE = /^[A-Za-z0-9_][A-Za-z0-9._\-/]*$/;

// Field segments that would enable prototype pollution or inherited lookups.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate a `--link` alias against the server's token-alias grammar.
 */
export function validateTokenAlias(alias: string): ValidationResult {
  if (alias.length === 0) {
    return { valid: false, error: 'alias must not be empty' };
  }
  if (alias.length > TOKEN_ALIAS_MAX) {
    return { valid: false, error: `alias must be at most ${TOKEN_ALIAS_MAX} characters` };
  }
  if (!TOKEN_ALIAS_RE.test(alias)) {
    return {
      valid: false,
      error:
        'alias must start with a letter, number, or underscore and contain only '
        + '[A-Za-z0-9._-/]',
    };
  }
  return { valid: true };
}

/**
 * Validate a `--link-field` dot-path: non-empty segments, no prototype-pollution
 * keys, within the length cap.
 */
export function validateFieldPath(path: string): ValidationResult {
  if (path.length === 0) {
    return { valid: false, error: 'field path must not be empty' };
  }
  if (path.length > FIELD_PATH_MAX) {
    return { valid: false, error: `field path must be at most ${FIELD_PATH_MAX} characters` };
  }
  const segments = path.split('.');
  for (const segment of segments) {
    if (segment.length === 0) {
      return { valid: false, error: 'field path has an empty segment' };
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return { valid: false, error: `field path segment "${segment}" is not allowed` };
    }
  }
  return { valid: true };
}

/**
 * Build a link pointer from an alias and optional field. An empty/undefined
 * field is omitted (a field-less link returns the target's whole value).
 */
export function buildLinkData(alias: string, field?: string): LinkData {
  if (field !== undefined && field.length > 0) {
    return { ref: alias, field };
  }
  return { ref: alias };
}
