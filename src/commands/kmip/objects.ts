// Path: src/commands/kmip/objects.ts
// KMIP managed-object commands (metadata only).

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { KmipConfigStatus, KmipObject, PaginatedResponse } from './types.js';

export async function listObjects(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching KMIP objects...').start();
  try {
    const response = await client.get<PaginatedResponse<KmipObject>>('/v1/kmip/objects');
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    if (response.items.length === 0) {
      output.info('No KMIP objects.');
      return;
    }
    output.table(
      ['ID', 'Type', 'State', 'Names'],
      response.items.map((o) => [
        `${o.id.slice(0, 8)}…`,
        o.objectType,
        o.state,
        o.names.join(', ') || '-',
      ])
    );
  } catch (err) {
    spinner.fail('Failed to list KMIP objects');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getStatus(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching KMIP status...').start();
  try {
    const response = await client.get<KmipConfigStatus>('/v1/kmip/config');
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    output.keyValue({
      'Listener Enabled': String(response.listener.enabled),
      'Listening': String(response.listener.listening),
      'Port': String(response.listener.port),
      'PKI Initialized': String(response.pkiInitialized),
      'Server Cert Expires': response.serverCertNotAfter ?? '-',
      'Days To Expiry': response.serverCertDaysToExpiry === null ? '-' : String(response.serverCertDaysToExpiry),
    });
    if (!response.pkiInitialized) {
      output.info('PKI not initialized. A superadmin must run: znvault superadmin kmip enable');
    }
  } catch (err) {
    spinner.fail('Failed to get KMIP status');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
