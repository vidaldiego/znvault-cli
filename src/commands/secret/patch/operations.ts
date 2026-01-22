// Path: src/commands/secret/patch/operations.ts

/**
 * Path parsing and set/unset operations for secret patching
 */

import {
  type PathSegment,
  type ParsedPath,
  type PatchOperation,
  type AppliedOperation,
  PatchError,
} from './types.js';

// ============================================================================
// Path Parsing
// ============================================================================

/**
 * Parse a dot-notation path into segments
 * Supports:
 * - key           -> top-level key
 * - a.b.c         -> nested keys
 * - arr[0]        -> array index
 * - arr[+]        -> array append
 * - a.b[0].c      -> mixed paths
 *
 * @param path - The path string to parse
 * @returns ParsedPath with segments
 */
export function parsePath(path: string): ParsedPath {
  if (!path || path.trim() === '') {
    throw new PatchError('Empty path', 'INVALID_PATH', { path });
  }

  const segments: PathSegment[] = [];
  let current = '';
  let i = 0;

  while (i < path.length) {
    const char = path[i];

    if (char === '.') {
      // End of a key segment
      if (current) {
        segments.push({ type: 'key', key: current });
        current = '';
      }
      i++;
    } else if (char === '[') {
      // Start of array index
      if (current) {
        segments.push({ type: 'key', key: current });
        current = '';
      }

      // Find closing bracket
      const closingBracket = path.indexOf(']', i);
      if (closingBracket === -1) {
        throw new PatchError(
          `Unclosed bracket in path: ${path}`,
          'INVALID_PATH',
          { path, position: i }
        );
      }

      const indexStr = path.slice(i + 1, closingBracket);

      if (indexStr === '+') {
        // Append operation
        segments.push({ type: 'append' });
      } else if (/^\d+$/.test(indexStr)) {
        // Numeric index
        segments.push({ type: 'index', index: parseInt(indexStr, 10) });
      } else {
        throw new PatchError(
          `Invalid array index: ${indexStr}`,
          'INVALID_PATH',
          { path, index: indexStr }
        );
      }

      i = closingBracket + 1;

      // Skip dot after bracket if present
      if (i < path.length && path[i] === '.') {
        i++;
      }
    } else {
      current += char;
      i++;
    }
  }

  // Add final segment
  if (current) {
    segments.push({ type: 'key', key: current });
  }

  if (segments.length === 0) {
    throw new PatchError('Path has no valid segments', 'INVALID_PATH', { path });
  }

  return { segments, raw: path };
}

// ============================================================================
// Value Type Inference
// ============================================================================

/**
 * Infer the type of a string value and convert it
 * - "true"/"false" -> boolean
 * - numeric strings -> number
 * - "null" -> null
 * - otherwise -> string
 *
 * @param value - The string value to infer
 * @returns The inferred value with correct type
 */
export function inferValueType(value: string): unknown {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Null
  if (value === 'null') return null;

  // Number (integer or float)
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }

  // String (default)
  return value;
}

/**
 * Parse a value that might be JSON
 * If it starts with { or [, try to parse as JSON
 * Otherwise use type inference
 */
export function parseValue(value: string): unknown {
  const trimmed = value.trim();

  // Try to parse as JSON for objects and arrays
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not valid JSON, return as string
      return value;
    }
  }

  return inferValueType(value);
}

// ============================================================================
// Set/Unset Operations
// ============================================================================

/**
 * Get a value at a path from an object
 */
export function getAtPath(obj: unknown, parsedPath: ParsedPath): unknown {
  let current = obj;

  for (const segment of parsedPath.segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (segment.type === 'key') {
      if (typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment.key];
    } else if (segment.type === 'index') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment.index];
    } else {
      // segment.type === 'append': Can't get from append position
      return undefined;
    }
  }

  return current;
}

/**
 * Set a value at a path in an object (mutates the object)
 *
 * @param obj - The object to modify
 * @param parsedPath - The parsed path
 * @param value - The value to set
 * @returns The previous value at the path (if any)
 */
export function setAtPath(
  obj: Record<string, unknown>,
  parsedPath: ParsedPath,
  value: unknown
): unknown {
  const { segments } = parsedPath;

  // Navigate to parent, creating intermediate objects/arrays as needed
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];

    if (segment.type === 'key') {
      const currentObj = current as Record<string, unknown>;
      // Create intermediate container based on next segment type
      currentObj[segment.key] ??= nextSegment.type === 'index' || nextSegment.type === 'append'
        ? []
        : {};
      current = currentObj[segment.key];
    } else if (segment.type === 'index') {
      const currentArr = current as unknown[];
      currentArr[segment.index] ??= nextSegment.type === 'index' || nextSegment.type === 'append'
        ? []
        : {};
      current = currentArr[segment.index];
    } else {
      throw new PatchError(
        'Append operator [+] can only be used at the end of a path',
        'INVALID_PATH',
        { path: parsedPath.raw }
      );
    }
  }

  // Set the final value
  const lastSegment = segments[segments.length - 1];
  let previousValue: unknown;

  if (lastSegment.type === 'key') {
    const parent = current as Record<string, unknown>;
    previousValue = parent[lastSegment.key];
    parent[lastSegment.key] = value;
  } else if (lastSegment.type === 'index') {
    const parent = current as unknown[];
    previousValue = parent[lastSegment.index];
    parent[lastSegment.index] = value;
  } else {
    // lastSegment.type === 'append'
    if (!Array.isArray(current)) {
      throw new PatchError(
        'Cannot append to non-array',
        'TYPE_MISMATCH',
        { path: parsedPath.raw, actualType: typeof current }
      );
    }
    (current as unknown[]).push(value);
    previousValue = undefined;
  }

  return previousValue;
}

/**
 * Remove a value at a path in an object (mutates the object)
 *
 * @param obj - The object to modify
 * @param parsedPath - The parsed path
 * @returns The removed value (if any)
 */
export function unsetAtPath(
  obj: Record<string, unknown>,
  parsedPath: ParsedPath
): unknown {
  const { segments } = parsedPath;

  // Navigate to parent
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];

    if (segment.type === 'key') {
      const currentObj = current as Record<string, unknown>;
      if (currentObj[segment.key] === undefined) {
        return undefined; // Path doesn't exist
      }
      current = currentObj[segment.key];
    } else if (segment.type === 'index') {
      const currentArr = current as unknown[];
      if (currentArr[segment.index] === undefined) {
        return undefined;
      }
      current = currentArr[segment.index];
    } else {
      throw new PatchError(
        'Append operator [+] cannot be used with unset',
        'UNSUPPORTED_OPERATION',
        { path: parsedPath.raw }
      );
    }

    if (current === null || current === undefined) {
      return undefined;
    }
  }

  // Remove the final value
  const lastSegment = segments[segments.length - 1];
  let removedValue: unknown;

  if (lastSegment.type === 'key') {
    if (typeof current !== 'object' || Array.isArray(current) || current === null) {
      return undefined;
    }
    const parent = current as Record<string, unknown>;
    const keyToDelete = lastSegment.key;
    removedValue = parent[keyToDelete];
    Reflect.deleteProperty(parent, keyToDelete);
  } else if (lastSegment.type === 'index') {
    if (!Array.isArray(current)) {
      return undefined;
    }
    const parent = current as unknown[];
    if (lastSegment.index >= 0 && lastSegment.index < parent.length) {
      removedValue = parent[lastSegment.index];
      parent.splice(lastSegment.index, 1);
    }
  } else {
    throw new PatchError(
      'Append operator [+] cannot be used with unset',
      'UNSUPPORTED_OPERATION',
      { path: parsedPath.raw }
    );
  }

  return removedValue;
}

// ============================================================================
// Apply Operations
// ============================================================================

/**
 * Apply a list of patch operations to an object
 *
 * @param obj - The object to modify (will be deep cloned)
 * @param operations - The operations to apply
 * @returns Array of applied operations with details
 */
export function applyOperations(
  obj: Record<string, unknown>,
  operations: PatchOperation[]
): AppliedOperation[] {
  const applied: AppliedOperation[] = [];

  for (const op of operations) {
    const parsedPath = parsePath(op.path);

    if (op.type === 'set') {
      const previousValue = setAtPath(obj, parsedPath, op.value);
      applied.push({
        type: 'set',
        path: op.path,
        previousValue,
        newValue: op.value,
      });
    } else {
      // op.type === 'unset'
      const removedValue = unsetAtPath(obj, parsedPath);
      applied.push({
        type: 'unset',
        path: op.path,
        previousValue: removedValue,
      });
    }
  }

  return applied;
}

/**
 * Parse --set arguments into operations
 * Format: path=value
 */
export function parseSetArgs(args: string[]): PatchOperation[] {
  return args.map(arg => {
    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
      throw new PatchError(
        `Invalid --set argument: ${arg} (expected path=value)`,
        'INVALID_VALUE',
        { arg }
      );
    }

    const path = arg.slice(0, eqIndex);
    const valueStr = arg.slice(eqIndex + 1);

    return {
      type: 'set' as const,
      path,
      value: parseValue(valueStr),
    };
  });
}

/**
 * Parse --unset arguments into operations
 */
export function parseUnsetArgs(args: string[]): PatchOperation[] {
  return args.map(path => ({
    type: 'unset' as const,
    path,
  }));
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
