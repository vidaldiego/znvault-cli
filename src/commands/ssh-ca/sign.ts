// Path: src/commands/ssh-ca/sign.ts

/**
 * Certificate signing command for SSH CA
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { SignedCertificate, SignOptions } from './types.js';
import { formatDate, readPublicKey } from './helpers.js';

export async function signCertificate(options: SignOptions): Promise<void> {
  let publicKey: string;

  try {
    if (options.publicKey) {
      publicKey = options.publicKey;
    } else if (options.file) {
      publicKey = await readPublicKey(options.file);
    } else {
      // Try reading from stdin
      publicKey = await readPublicKey();
    }
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Validate public key format
  if (!publicKey.startsWith('ssh-')) {
    output.error('Invalid SSH public key format. Key should start with ssh-ed25519, ssh-rsa, etc.');
    process.exit(1);
  }

  const spinner = ora('Signing certificate...').start();

  try {
    const body: { publicKey: string; ttlSeconds?: number; principals?: string[]; tenantId?: string } = { publicKey };
    if (options.ttl) {
      body.ttlSeconds = parseInt(options.ttl, 10);
    }
    if (options.principals) {
      body.principals = options.principals.split(',').map(p => p.trim()).filter(p => p);
    }
    if (options.tenant) {
      body.tenantId = options.tenant;
    }

    const response = await client.post<SignedCertificate>('/v1/ssh/sign', body);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    // Check if output is being piped
    if (!process.stdout.isTTY) {
      // Just output the certificate for piping to file
      console.log(response.certificate);
      return;
    }

    // Interactive output
    output.success('Certificate signed successfully!');
    console.log();

    output.keyValue({
      'Serial': response.serial,
      'Fingerprint': response.fingerprint,
      'Principals': response.principals.join(', '),
      'Valid From': formatDate(response.validAfter),
      'Valid Until': formatDate(response.validBefore),
    });

    console.log();
    console.log('Certificate:');
    console.log(response.certificate);
    console.log();

    output.info('Save to file:');
    output.info('  znvault ssh-ca sign --file ~/.ssh/id_ed25519.pub > ~/.ssh/id_ed25519-cert.pub');
    console.log();
    output.info('Or use directly:');
    output.info('  ssh -i ~/.ssh/id_ed25519 -o CertificateFile=<(znvault ssh-ca sign ...) user@host');
  } catch (err) {
    spinner.fail('Failed to sign certificate');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
