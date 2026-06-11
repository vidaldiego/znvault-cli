// Path: src/commands/kmip/admin.ts
// Superadmin KMIP commands (enable PKI, re-issue server cert).

import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { KmipConfigStatus } from './types.js';

export async function enableKmip(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Initializing KMIP PKI and starting the listener...').start();
  try {
    const response = await client.post<KmipConfigStatus & { listener: { listening: boolean; port: number } }>(
      '/v1/superadmin/kmip/enable',
      {}
    );
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    output.success('KMIP enabled');
    output.keyValue({
      'Listening': String(response.listener.listening),
      'Port': String(response.listener.port),
      'Server Cert Expires': response.serverCertNotAfter ?? '-',
    });
  } catch (err) {
    spinner.fail('Failed to enable KMIP');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function reissueServerCert(options: { yes?: boolean; json?: boolean }): Promise<void> {
  if (!options.yes) {
    output.warn(
      'Re-issuing the KMIP server certificate may require a manual recovery-key unlock on EVERY enrolled NAS.'
    );
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      { type: 'confirm', name: 'confirm', message: 'Proceed with server certificate re-issue?', default: false },
    ]);
    if (!confirm) {
      output.info('Aborted.');
      return;
    }
  }

  const spinner = output.spinner('Re-issuing KMIP server certificate...').start();
  try {
    const response = await client.post<{ serverCertNotAfter: string | null; warning?: string }>(
      '/v1/superadmin/kmip/server-cert/reissue',
      { confirm: true }
    );
    spinner.stop();
    if (options.json) {
      output.json(response);
      return;
    }
    output.success('Server certificate re-issued');
    output.keyValue({ 'New Expiry': response.serverCertNotAfter ?? '-' });
    if (response.warning) output.warn(response.warning);
  } catch (err) {
    spinner.fail('Failed to re-issue server certificate');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
