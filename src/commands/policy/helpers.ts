// Path: src/commands/policy/helpers.ts

/**
 * Helper functions for policy commands
 */

import * as fs from 'fs';

/**
 * Safely read a file with proper error handling
 */
export function safeReadFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('EACCES')) {
        throw new Error(`Permission denied: ${filePath}`);
      }
      if (err.message.includes('EISDIR')) {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
      }
    }
    throw new Error(`Failed to read file: ${filePath}`);
  }
}

/**
 * Safely parse JSON with proper error handling
 */
export function safeParseJson<T>(content: string, context: string): T {
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${context}: ${err.message}`);
    }
    throw new Error(`Failed to parse ${context} as JSON`);
  }
}

/**
 * Safely write a file with proper error handling
 */
export function safeWriteFile(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('EACCES')) {
        throw new Error(`Permission denied: ${filePath}`);
      }
      if (err.message.includes('ENOENT')) {
        throw new Error(`Directory does not exist: ${filePath}`);
      }
    }
    throw new Error(`Failed to write file: ${filePath}`);
  }
}
