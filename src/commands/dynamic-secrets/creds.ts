// Path: src/commands/dynamic-secrets/creds.ts

/**
 * Credential generation commands for dynamic secrets
 */


import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { GeneratedCredential } from './types.js';
import { formatDuration, formatDate } from './helpers.js';

export async function generateCredentials(roleId: string, options: {
  ttl?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = output.spinner('Generating credentials...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.ttl) body.ttlSeconds = parseInt(options.ttl, 10);

    const response = await client.post<GeneratedCredential>(`/v1/dynamic-secrets/roles/${roleId}/credentials`, body);
    spinner.succeed('Credentials generated');

    if (options.json) {
      output.json(response);
      return;
    }

    console.log('');
    output.keyValue({
      'Lease ID': response.leaseId,
      'Username': response.username,
      'Password': response.password,
      'TTL': formatDuration(response.ttlSeconds),
      'Expires At': formatDate(response.expiresAt),
      'Max Expires At': formatDate(response.maxExpiresAt),
    });

    console.log('');
    output.warn('The password is shown only once. Store it securely or use it immediately.');
  } catch (err) {
    spinner.fail('Failed to generate credentials');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
