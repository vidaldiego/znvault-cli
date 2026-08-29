import type { Command } from 'commander';
import { fstatSync } from 'node:fs';

import { getProfile, mutateProfileAuthentication } from '../lib/config.js';
import * as output from '../lib/output.js';

const API_KEY_PATTERN = /^znv_[0-9a-f]{64}$/;
const MAX_STDIN_BYTES = 70; // 68-byte key plus one optional CRLF.

interface ImportApiKeyOptions {
  stdin?: boolean;
  json?: boolean;
}

async function readApiKeyFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('API key import requires piped stdin');
  }
  const stdinStat = fstatSync(0);
  if (!stdinStat.isFIFO() && !stdinStat.isSocket()) {
    throw new Error('API key import requires piped stdin');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    totalBytes += bytes.length;
    if (totalBytes > MAX_STDIN_BYTES) {
      for (const buffered of chunks) buffered.fill(0);
      bytes.fill(0);
      throw new Error('Invalid API key input');
    }
    chunks.push(bytes);
  }

  const raw = Buffer.concat(chunks, totalBytes);
  for (const chunk of chunks) chunk.fill(0);
  let value = raw.toString('utf8');
  raw.fill(0);

  if (value.endsWith('\r\n')) {
    value = value.slice(0, -2);
  } else if (value.endsWith('\n')) {
    value = value.slice(0, -1);
  }

  if (!API_KEY_PATTERN.test(value)) {
    throw new Error('Invalid API key input');
  }
  return value;
}

/**
 * Register the explicit, stdin-only API-key profile import surface.
 *
 * The key never enters argv, the environment, stdout, stderr, or an
 * intermediate file. The target must be a new, unauthenticated profile so an
 * import cannot silently replace an existing principal.
 */
export function registerProfileApiKeyCommands(profileCmd: Command): void {
  const apiKeyCmd = profileCmd
    .command('api-key')
    .description('Manage API-key authentication for profiles');

  apiKeyCmd
    .command('import <profile>')
    .description('Import an API key from stdin into an empty profile')
    .option('--stdin', 'Read the API key from standard input (required)')
    .option('--json', 'Output a secret-free JSON receipt')
    .action(async (profileName: string, options: ImportApiKeyOptions) => {
      try {
        if (options.stdin !== true) {
          throw new Error('Refusing API key import without --stdin');
        }

        const profile = getProfile(profileName);
        if (!profile) {
          throw new Error(`Profile '${profileName}' not found`);
        }
        if (profile.apiKey || profile.credentials) {
          throw new Error(`Profile '${profileName}' already has authentication configured`);
        }

        const apiKey = await readApiKeyFromStdin();
        mutateProfileAuthentication(profileName, (currentProfile) => {
          if (currentProfile.apiKey || currentProfile.credentials) {
            throw new Error(`Profile '${profileName}' already has authentication configured`);
          }
          return { ...currentProfile, apiKey };
        });

        const receipt = {
          success: true,
          profile: profileName,
          authMethod: 'api-key',
          secretsEmitted: false,
        };
        if (options.json) {
          output.json(receipt);
        } else {
          output.success(`API key imported into profile '${profileName}'`);
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : 'API key import failed');
        process.exit(1);
      }
    });
}
