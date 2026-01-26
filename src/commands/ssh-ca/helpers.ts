// Path: src/commands/ssh-ca/helpers.ts

/**
 * Helper functions for SSH CA commands
 */

import chalk from 'chalk';

// Re-export common formatters from centralized location
export { formatTtl, formatDate } from '../../lib/format-helpers.js';

/**
 * Format certificate validity status
 */
export function formatValidity(validBefore: string, revoked: boolean): string {
  if (revoked) {
    return chalk.red('REVOKED');
  }

  const expiry = new Date(validBefore);
  const now = new Date();

  if (expiry < now) {
    return chalk.gray('EXPIRED');
  }

  const hoursLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60));
  if (hoursLeft < 1) {
    return chalk.yellow('EXPIRING');
  }

  return chalk.green('VALID');
}

/**
 * Format key type for display
 */
export function formatKeyType(keyType: string | undefined): string {
  if (!keyType) return '-';
  return keyType === 'ed25519' ? 'Ed25519' : 'RSA-4096';
}

/**
 * Format principals array
 */
export function formatPrincipals(principals: string[]): string {
  if (!principals || principals.length === 0) return '-';
  if (principals.length <= 3) return principals.join(', ');
  return `${principals.slice(0, 3).join(', ')} (+${principals.length - 3})`;
}

/**
 * Parse principals from comma-separated string
 */
export function parsePrincipals(input: string): string[] {
  return input.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * Parse extensions from comma-separated string
 */
export function parseExtensions(input: string): string[] {
  return input.split(',').map(e => e.trim()).filter(e => e.length > 0);
}

/**
 * Validate principal name
 */
export function isValidPrincipal(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Read public key from file or stdin
 */
export async function readPublicKey(file?: string): Promise<string> {
  const fs = await import('fs/promises');

  if (file) {
    const content = await fs.readFile(file, 'utf8');
    return content.trim();
  }

  // Read from stdin if piped
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data.trim()));
      process.stdin.on('error', reject);
    });
  }

  throw new Error('No public key provided. Use --public-key, --file, or pipe to stdin.');
}
