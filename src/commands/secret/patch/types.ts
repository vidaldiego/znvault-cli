// Path: src/commands/secret/patch/types.ts

/**
 * Type definitions for secret patch command
 */

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Supported patch operations
 */
export type PatchOperationType = 'set' | 'unset';

/**
 * A single patch operation to apply
 */
export interface PatchOperation {
  type: PatchOperationType;
  path: string;
  value?: unknown; // Only for 'set' operations
}

// ============================================================================
// Format Types
// ============================================================================

/**
 * Supported data formats for secrets
 */
export type SecretFormat = 'json' | 'yaml' | 'env' | 'properties' | 'toml' | 'conf';

/**
 * All supported formats as an array for validation
 */
export const SUPPORTED_FORMATS: SecretFormat[] = ['json', 'yaml', 'env', 'properties', 'toml', 'conf'];

// ============================================================================
// Path Segment Types
// ============================================================================

/**
 * A parsed path segment - can be a key or array index
 */
export type PathSegment =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number }
  | { type: 'append' }; // For arr[+] syntax

/**
 * A fully parsed path with segments
 */
export interface ParsedPath {
  segments: PathSegment[];
  raw: string;
}

// ============================================================================
// Command Options
// ============================================================================

/**
 * Options for the patch command
 */
export interface PatchOptions {
  set?: string[]; // Repeatable --set path=value
  unset?: string[]; // Repeatable --unset path
  format?: SecretFormat;
  dryRun?: boolean;
  json?: boolean;
}

// ============================================================================
// Patch Result Types
// ============================================================================

/**
 * Result of applying a patch operation
 */
export interface PatchResult {
  success: boolean;
  originalValue?: unknown;
  newValue: unknown;
  operations: AppliedOperation[];
  format: SecretFormat;
  diff?: DiffResult;
}

/**
 * Details of an applied operation
 */
export interface AppliedOperation {
  type: PatchOperationType;
  path: string;
  previousValue?: unknown;
  newValue?: unknown;
}

/**
 * Diff result for dry-run mode
 */
export interface DiffResult {
  before: string;
  after: string;
  changes: DiffChange[];
}

/**
 * A single change in the diff
 */
export interface DiffChange {
  type: 'add' | 'remove' | 'modify';
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
}

// ============================================================================
// Parser Types
// ============================================================================

/**
 * Interface for format parsers
 */
export interface FormatParser {
  parse(content: string): Record<string, unknown>;
  stringify(data: Record<string, unknown>): string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error for patch operations
 */
export class PatchError extends Error {
  constructor(
    message: string,
    public readonly code: PatchErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PatchError';
  }
}

/**
 * Error codes for patch operations
 */
export type PatchErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_VALUE'
  | 'INVALID_FORMAT'
  | 'PARSE_ERROR'
  | 'SERIALIZE_ERROR'
  | 'PATH_NOT_FOUND'
  | 'TYPE_MISMATCH'
  | 'UNSUPPORTED_OPERATION';
