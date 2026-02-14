// Path: src/commands/ssh-ca/certificates.ts

/**
 * Certificate management commands for SSH CA
 */


import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  SSHCertificate,
  CertificatesListResponse,
  CertListOptions,
  RevokeOptions,
} from './types.js';
import { formatDate, formatValidity, formatPrincipals } from './helpers.js';

export async function listCertificates(options: CertListOptions): Promise<void> {
  const spinner = output.spinner('Fetching certificates...').start();

  try {
    const params = new URLSearchParams();
    if (options.activeOnly) params.set('activeOnly', 'true');
    if (options.revoked) params.set('revoked', 'true');
    if (options.userId) params.set('userId', options.userId);
    if (options.limit) params.set('limit', options.limit);

    const query = params.toString();
    const response = await client.get<CertificatesListResponse>(
      `/v1/ssh/certificates${query ? `?${query}` : ''}`
    );
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.items.length === 0) {
      output.info('No certificates found.');
      return;
    }

    const table = new Table({
      head: ['Serial', 'User', 'Principals', 'Valid Until', 'Status'],
      style: { head: ['cyan'] },
    });

    for (const cert of response.items) {
      table.push([
        cert.serial,
        cert.username ?? cert.userId.substring(0, 8),
        formatPrincipals(cert.principals),
        formatDate(cert.validBefore),
        formatValidity(cert.validBefore, cert.revoked),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.items.length} certificate(s) found (total: ${response.pagination.total})`);
  } catch (err) {
    spinner.fail('Failed to list certificates');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getCertificate(certId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching certificate...').start();

  try {
    const cert = await client.get<SSHCertificate>(`/v1/ssh/certificates/${certId}`);
    spinner.stop();

    if (options.json) {
      output.json(cert);
      return;
    }

    output.keyValue({
      'ID': cert.id,
      'Serial': cert.serial,
      'User': cert.username ?? cert.userId,
      'Fingerprint': cert.fingerprint,
      'Principals': cert.principals.join(', '),
      'Extensions': cert.extensions?.join(', ') ?? '-',
      'Valid From': formatDate(cert.validAfter),
      'Valid Until': formatDate(cert.validBefore),
      'Status': formatValidity(cert.validBefore, cert.revoked),
      'Request IP': cert.requestIp ?? '-',
      'Created': formatDate(cert.createdAt),
    });

    if (cert.revoked) {
      console.log();
      output.warn('Certificate is revoked:');
      output.keyValue({
        'Revoked At': formatDate(cert.revokedAt),
        'Revoked By': cert.revokedBy ?? '-',
        'Reason': cert.revocationReason ?? '-',
      });
    }
  } catch (err) {
    spinner.fail('Failed to get certificate');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function revokeCertificate(certId: string, options: RevokeOptions): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Revoke certificate ${certId}?`,
      default: false,
    }]);

    if (!confirm) {
      output.info('Operation cancelled.');
      return;
    }
  }

  const reason = options.reason ?? (await inquirer.prompt<{ reason: string }>([{
    type: 'input',
    name: 'reason',
    message: 'Revocation reason (optional):',
    default: 'Manually revoked via CLI',
  }])).reason;

  const spinner = output.spinner('Revoking certificate...').start();

  try {
    await client.post(`/v1/ssh/certificates/${certId}/revoke`, { reason });
    spinner.succeed('Certificate revoked');

    if (options.json) {
      output.json({ success: true, certId, reason });
    } else {
      output.info('Certificate has been added to the Key Revocation List.');
      output.info('Servers should refresh their KRL: znvault ssh-ca krl');
    }
  } catch (err) {
    spinner.fail('Failed to revoke certificate');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
