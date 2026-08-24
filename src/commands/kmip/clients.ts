// Path: src/commands/kmip/clients.ts
// KMIP client management commands.

import fs from 'fs';
import path from 'path';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { KmipClient, KmipClientCreateResponse, PaginatedResponse } from './types.js';

interface CreateOptions {
  description?: string;
  outputDir?: string;
  allowedCidrs?: string;
  json?: boolean;
}

/** Parse a comma-separated CIDR list into a trimmed string[] (empty if unset). */
function parseCidrList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function createClient(name: string, options: CreateOptions): Promise<void> {
  const spinner = output.spinner(`Creating KMIP client '${name}'...`).start();
  try {
    const allowedSourceCidrs = parseCidrList(options.allowedCidrs);
    const response = await client.post<KmipClientCreateResponse>('/v1/kmip/clients', {
      name,
      description: options.description,
      ...(allowedSourceCidrs.length > 0 ? { allowedSourceCidrs } : {}),
    });
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.success(`KMIP client '${name}' created`);
    output.keyValue({
      ID: response.id,
      Fingerprint: response.certFingerprint,
      'Expires': response.certNotAfter ?? '-',
    });

    // Write the three files DSM imports (the only chance — the key is never stored).
    const dir = options.outputDir ?? `kmip-${name}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'client.key'), response.bundle.clientKeyPem, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'client.crt'), response.bundle.clientCertPem);
    fs.writeFileSync(path.join(dir, 'ca.crt'), response.bundle.caCertPem);
    output.info(`Bundle written to ${dir}/ (client.key, client.crt, ca.crt)`);
    output.warn('The private key is shown only once and is NOT stored on the server. Keep it safe.');
  } catch (err) {
    spinner.fail('Failed to create KMIP client');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listClients(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching KMIP clients...').start();
  try {
    const response = await client.get<PaginatedResponse<KmipClient>>('/v1/kmip/clients');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }
    if (response.items.length === 0) {
      output.info('No KMIP clients.');
      return;
    }
    output.table(
      ['Name', 'Status', 'Fingerprint', 'Last Seen', 'Expires'],
      response.items.map((c) => [
        c.name,
        c.status,
        `${c.certFingerprint.slice(0, 16)}…`,
        c.lastSeenAt ?? '-',
        c.certNotAfter ?? '-',
      ])
    );
  } catch (err) {
    spinner.fail('Failed to list KMIP clients');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function setSourceCidrs(
  id: string,
  cidrs: string,
  options: { json?: boolean }
): Promise<void> {
  const allowedSourceCidrs = parseCidrList(cidrs);
  const verb = allowedSourceCidrs.length > 0 ? 'Setting' : 'Clearing';
  const spinner = output.spinner(`${verb} source-IP allowlist for KMIP client ${id}...`).start();
  try {
    const response = await client.put<KmipClient>(`/v1/kmip/clients/${id}/source-cidrs`, {
      allowedSourceCidrs,
    });
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    if (allowedSourceCidrs.length > 0) {
      output.success(`Source-IP allowlist set for '${response.name}': ${allowedSourceCidrs.join(', ')}`);
    } else {
      output.success(`Source-IP allowlist cleared for '${response.name}' (no restriction)`);
    }
  } catch (err) {
    spinner.fail('Failed to set KMIP client source-IP allowlist');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function revokeClient(id: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner(`Revoking KMIP client ${id}...`).start();
  try {
    const response = await client.post<KmipClient>(`/v1/kmip/clients/${id}/revoke`, {});
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    output.success(`KMIP client '${response.name}' revoked`);
  } catch (err) {
    spinner.fail('Failed to revoke KMIP client');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
