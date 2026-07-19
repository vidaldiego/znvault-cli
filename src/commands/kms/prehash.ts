// Path: src/commands/kms/prehash.ts

/**
 * KMS prehashed-signing arming (jsign / Windows Authenticode).
 *
 * Arm/disarm an RSA SIGN_VERIFY key for prehashed (digest) signing via the
 * tenant-only route `PATCH /v1/kms/keys/:id/prehash`. There is no superadmin
 * counterpart (the server rejects superadmin on this tenant route), so these
 * commands hardcode the tenant path and are registered under the tenant tree
 * only — exactly like KMS crypto ops and policies. Arming requires the
 * `kms:key:prehash-manage` permission, or a tenant admin (admin bypass).
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { encodeKeyId } from './helpers.js';
import type { PrehashOptions } from './types.js';

interface PrehashResult {
  keyId: string;
  prehashAllowed: boolean;
}

async function setPrehash(keyId: string, enabled: boolean, options: PrehashOptions): Promise<void> {
  const spinner = output
    .spinner(enabled ? 'Arming key for prehashed signing...' : 'Disarming key...')
    .start();

  try {
    // Tenant-only route — no /v1/superadmin/* variant exists (separation of
    // duties: superadmins cannot arm tenant keys). Hardcode the tenant path.
    const result = await client.patch<PrehashResult>(`/v1/kms/keys/${encodeKeyId(keyId)}/prehash`, { enabled });
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success(
      `Key ${keyId} ${enabled ? 'armed for' : 'disarmed from'} prehashed (digest) signing`
    );
    console.log(`  prehashAllowed: ${result.prehashAllowed}`);
  } catch (error) {
    spinner.fail(enabled ? 'Failed to arm key' : 'Failed to disarm key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

export function registerPrehashCommands(parent: Command): void {
  const prehash = parent
    .command('prehash')
    .description(
      'Arm/disarm an RSA SIGN_VERIFY key for prehashed (digest) signing (jsign / Authenticode)'
    );

  prehash
    .command('enable <keyId>')
    .description(
      'Arm a key for prehashed signing (requires kms:key:prehash-manage or tenant-admin; superadmin is rejected by the server)'
    )
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: PrehashOptions) => setPrehash(keyId, true, options));

  prehash
    .command('disable <keyId>')
    .description('Disarm a key from prehashed signing')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: PrehashOptions) => setPrehash(keyId, false, options));
}
