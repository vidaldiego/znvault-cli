// Path: src/commands/secret/patch/parsers.ts

/**
 * Format parsers for secret patching
 * Supports: JSON, YAML, env, properties, TOML
 */

import YAML from 'yaml';
import * as TOML from '@iarna/toml';
import {
  type SecretFormat,
  type FormatParser,
  PatchError,
} from './types.js';

// ============================================================================
// JSON Parser
// ============================================================================

const jsonParser: FormatParser = {
  parse(content: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new PatchError(
          'JSON must be an object at the root level',
          'PARSE_ERROR',
          { content: content.slice(0, 100) }
        );
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof PatchError) throw err;
      throw new PatchError(
        `Invalid JSON: ${(err as Error).message}`,
        'PARSE_ERROR',
        { content: content.slice(0, 100) }
      );
    }
  },

  stringify(data: Record<string, unknown>): string {
    return JSON.stringify(data, null, 2);
  },
};

// ============================================================================
// YAML Parser
// ============================================================================

const yamlParser: FormatParser = {
  parse(content: string): Record<string, unknown> {
    try {
      const parsed: unknown = YAML.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new PatchError(
          'YAML must be an object at the root level',
          'PARSE_ERROR',
          { content: content.slice(0, 100) }
        );
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof PatchError) throw err;
      throw new PatchError(
        `Invalid YAML: ${(err as Error).message}`,
        'PARSE_ERROR',
        { content: content.slice(0, 100) }
      );
    }
  },

  stringify(data: Record<string, unknown>): string {
    return YAML.stringify(data);
  },
};

// ============================================================================
// ENV Parser (KEY=value format)
// ============================================================================

const envParser: FormatParser = {
  parse(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1);

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  },

  stringify(data: Record<string, unknown>): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;

      // Convert value to string safely
      let strValue: string;
      if (typeof value === 'object') {
        strValue = JSON.stringify(value);
      } else if (typeof value === 'string') {
        strValue = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        strValue = String(value);
      } else {
        strValue = JSON.stringify(value);
      }
      // Quote values with spaces or special characters
      const needsQuotes = /[\s"'=]/.test(strValue) || strValue.includes('\n');
      const quotedValue = needsQuotes
        ? `"${strValue.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
        : strValue;

      lines.push(`${key}=${quotedValue}`);
    }

    return lines.join('\n');
  },
};

// ============================================================================
// Properties Parser (Java-style key=value)
// ============================================================================

const propertiesParser: FormatParser = {
  parse(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');
    let currentKey = '';
    let currentValue = '';
    let continuation = false;

    for (const line of lines) {
      let trimmed = line;

      // Handle line continuation
      if (continuation) {
        trimmed = trimmed.trimStart();
      }

      // Skip comments (# or !)
      if (!continuation && (trimmed.startsWith('#') || trimmed.startsWith('!'))) {
        continue;
      }

      // Skip empty lines
      if (!continuation && trimmed.trim() === '') {
        continue;
      }

      // Check for continuation (ends with unescaped \)
      const endsWithBackslash = trimmed.endsWith('\\') && !trimmed.endsWith('\\\\');
      if (endsWithBackslash) {
        trimmed = trimmed.slice(0, -1);
      }

      if (continuation) {
        currentValue += trimmed;
      } else {
        // Find separator (= or :)
        let sepIndex = -1;
        for (let i = 0; i < trimmed.length; i++) {
          const char = trimmed[i];
          if ((char === '=' || char === ':') && (i === 0 || trimmed[i - 1] !== '\\')) {
            sepIndex = i;
            break;
          }
        }

        if (sepIndex === -1) {
          // Key without value
          currentKey = trimmed.trim();
          currentValue = '';
        } else {
          currentKey = trimmed.slice(0, sepIndex).trim();
          currentValue = trimmed.slice(sepIndex + 1).trimStart();
        }
      }

      if (endsWithBackslash) {
        continuation = true;
      } else {
        // Unescape and store
        result[currentKey] = currentValue.replace(/\\(.)/g, '$1');
        continuation = false;
        currentKey = '';
        currentValue = '';
      }
    }

    return result;
  },

  stringify(data: Record<string, unknown>): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;

      // Convert value to string safely
      let strValue: string;
      if (typeof value === 'object') {
        strValue = JSON.stringify(value);
      } else if (typeof value === 'string') {
        strValue = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        strValue = String(value);
      } else {
        strValue = JSON.stringify(value);
      }
      // Escape special characters
      const escapedValue = strValue
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');

      lines.push(`${key}=${escapedValue}`);
    }

    return lines.join('\n');
  },
};

// ============================================================================
// TOML Parser
// ============================================================================

const tomlParser: FormatParser = {
  parse(content: string): Record<string, unknown> {
    try {
      const parsed = TOML.parse(content);
      return parsed as Record<string, unknown>;
    } catch (err) {
      throw new PatchError(
        `Invalid TOML: ${(err as Error).message}`,
        'PARSE_ERROR',
        { content: content.slice(0, 100) }
      );
    }
  },

  stringify(data: Record<string, unknown>): string {
    try {
      return TOML.stringify(data as TOML.JsonMap);
    } catch (err) {
      throw new PatchError(
        `Cannot serialize to TOML: ${(err as Error).message}`,
        'SERIALIZE_ERROR'
      );
    }
  },
};

// ============================================================================
// Parser Registry
// ============================================================================

const parsers: Record<SecretFormat, FormatParser> = {
  json: jsonParser,
  yaml: yamlParser,
  env: envParser,
  properties: propertiesParser,
  toml: tomlParser,
};

/**
 * Get a parser for a specific format
 */
export function getParser(format: SecretFormat): FormatParser {
  return parsers[format];
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect format from content type or subType
 */
export function detectFormatFromMetadata(
  contentType?: string,
  subType?: string
): SecretFormat | undefined {
  // Check subType first (more specific)
  if (subType) {
    const subTypeLower = subType.toLowerCase();
    if (subTypeLower === 'json') return 'json';
    if (subTypeLower === 'yaml' || subTypeLower === 'yml') return 'yaml';
    if (subTypeLower === 'env' || subTypeLower === 'dotenv') return 'env';
    if (subTypeLower === 'properties' || subTypeLower === 'props') return 'properties';
    if (subTypeLower === 'toml') return 'toml';
  }

  // Check contentType
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('json')) return 'json';
    if (ct.includes('yaml') || ct.includes('yml')) return 'yaml';
    if (ct.includes('toml')) return 'toml';
    if (ct.includes('properties')) return 'properties';
  }

  return undefined;
}

/**
 * Detect format from content heuristics
 */
export function detectFormatFromContent(content: string): SecretFormat {
  const trimmed = content.trim();

  // JSON: starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON, continue
    }
  }

  // TOML: has [section] headers or key = "value" syntax
  if (/^\[[^\]]+\]/m.test(trimmed) ||
      /^[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*["']/m.test(trimmed)) {
    try {
      TOML.parse(trimmed);
      return 'toml';
    } catch {
      // Not valid TOML, continue
    }
  }

  // YAML: has --- header, indentation-based nesting, or : separator
  if (trimmed.startsWith('---') ||
      /^\s+[a-zA-Z_][a-zA-Z0-9_-]*:/m.test(trimmed) ||
      /^[a-zA-Z_][a-zA-Z0-9_-]*:\s*$/m.test(trimmed)) {
    try {
      const parsed: unknown = YAML.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return 'yaml';
      }
    } catch {
      // Not valid YAML, continue
    }
  }

  // ENV/Properties: KEY=value format
  const lines = trimmed.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'));
  const envLikeLines = lines.filter(l => /^[A-Z_][A-Z0-9_]*=/.test(l.trim()));
  if (envLikeLines.length > 0 && envLikeLines.length === lines.length) {
    return 'env';
  }

  // Properties: key=value or key: value format (lowercase allowed)
  const propsLikeLines = lines.filter(l => /^[a-zA-Z_][a-zA-Z0-9._-]*\s*[=:]/.test(l.trim()));
  if (propsLikeLines.length > 0 && propsLikeLines.length === lines.length) {
    return 'properties';
  }

  // Default to JSON
  return 'json';
}

/**
 * Detect format with priority:
 * 1. Explicit format option
 * 2. Metadata (contentType, subType)
 * 3. Content heuristics
 */
export function detectFormat(
  content: string,
  explicitFormat?: SecretFormat,
  contentType?: string,
  subType?: string
): SecretFormat {
  // Explicit format takes priority
  if (explicitFormat) {
    return explicitFormat;
  }

  // Try metadata
  const fromMetadata = detectFormatFromMetadata(contentType, subType);
  if (fromMetadata) {
    return fromMetadata;
  }

  // Fall back to content heuristics
  return detectFormatFromContent(content);
}

// Re-export types
export type { FormatParser };
