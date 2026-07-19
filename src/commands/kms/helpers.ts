// Path: src/commands/kms/helpers.ts

/**
 * KMS command helper functions
 */

import { createDebugLogger } from '../../lib/debug.js';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { PublicKeyResponse } from './types.js';

// Re-export common formatters from centralized location
export { formatDate, truncateId, formatPaginationInfo } from '../../lib/format-helpers.js';

const log = createDebugLogger('kms-helpers');

/**
 * URL-encode a key identifier for use as a SINGLE path segment.
 *
 * A KMS key may be addressed by UUID or by alias, and aliases are stored with
 * an `alias/` prefix (see createKey). Interpolating an alias raw yields
 * `/v1/kms/keys/alias/foo/public-key`, which does not match the server's
 * single-segment `:keyId` route and 404s. Encoding gives
 * `/v1/kms/keys/alias%2Ffoo/public-key`, which matches and decodes back to
 * `alias/foo` server-side (the repo resolves `id = :keyId OR alias = :alias`).
 * A UUID is unaffected (encodeURIComponent is identity for [A-Za-z0-9-]).
 */
export function encodeKeyId(keyId: string): string {
  return encodeURIComponent(keyId);
}

/**
 * Format key state for display
 */
export function formatKeyState(state: string): string {
  const stateMap: Record<string, string> = {
    'Enabled': 'Enabled',
    'Disabled': 'Disabled',
    'PendingDeletion': 'Pending Deletion',
    'PendingImport': 'Pending Import',
  };
  return stateMap[state] || state;
}

/**
 * Parse encryption context from string (JSON or key=value,... format)
 */
export function parseContext(contextStr?: string): Record<string, string> {
  if (!contextStr) return {};
  try {
    return JSON.parse(contextStr) as Record<string, string>;
  } catch (err) {
    log.silenced('parseContext:parseJson', err);
    // Try key=value format
    const context: Record<string, string> = {};
    const pairs = contextStr.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        context[key.trim()] = value.trim();
      }
    }
    return context;
  }
}

/**
 * Resolve the signing algorithm for a key.
 *
 * The API requires signingAlgorithm explicitly (an implicit default in a
 * signing API invites algorithm-confusion bugs). The CLI is allowed to be
 * friendlier: when a key spec admits exactly one algorithm, use it.
 */
export async function resolveAlgorithm(keyId: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;

  let key: PublicKeyResponse;
  try {
    key = await client.get<PublicKeyResponse>(`/v1/kms/keys/${encodeKeyId(keyId)}/public-key`);
  } catch (err) {
    output.error(`Could not read key ${keyId} to infer the signing algorithm: ${(err as Error).message}`);
    process.exit(1);
  }

  const algorithms = key.signingAlgorithms;
  if (algorithms.length === 1) return algorithms[0];

  output.error(
    `--algorithm is required for key spec ${key.keySpec}. Choose one of:\n  ${algorithms.join('\n  ')}`
  );
  process.exit(1);
}

/** Read the message bytes from --file or a positional argument. Exactly one is required. */
export async function readMessage(data: string | undefined, file: string | undefined): Promise<Buffer> {
  if (file && data) {
    output.error('Pass either a message argument or --file, not both');
    process.exit(1);
  }
  if (file) {
    const fs = await import('fs');
    if (!fs.existsSync(file)) {
      output.error(`File not found: ${file}`);
      process.exit(1);
    }
    return fs.readFileSync(file);
  }
  if (data) return Buffer.from(data, 'utf8');

  output.error('No message given: pass a message argument or --file');
  process.exit(1);
}
