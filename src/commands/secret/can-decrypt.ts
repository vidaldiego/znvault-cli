// Path: src/commands/secret/can-decrypt.ts

/**
 * Secret can-decrypt preflight command.
 *
 * Asks the server whether an identity (self, or a simulated api-key/user)
 * could decrypt a secret AND every secret it references, returning an honest
 * static-vs-conditional verdict. Never decrypts or returns a value.
 *
 * See SPEC 2026-07-06-secret-reference-metadata-and-can-decrypt-design.md (B6).
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  CanDecryptOptions,
  CanDecryptVerdict,
  CanDecryptTarget,
} from './types.js';
import { resolveSecretId } from './resolve.js';

/** Uppercase label for a node verdict (ALLOWED / DENIED / CONDITIONAL / INDETERMINATE). */
function verdictLabel(verdict: string): string {
  return verdict.toUpperCase();
}

/** One-line human suffix for a node: " — <reason>" (or conditionalOn hint), else empty. */
function reasonSuffix(node: { conditionalOn?: string[]; reason?: string }): string {
  if (node.reason && node.reason.length > 0) {
    return ` — ${node.reason}`;
  }
  if (node.conditionalOn && node.conditionalOn.length > 0) {
    return ` — depends on ${node.conditionalOn.join(', ')}`;
  }
  return '';
}

/** Render one reference target line per SPEC B6 (caller-invisible → hidden). */
function renderTarget(t: CanDecryptTarget): string {
  if (t.alias === null || t.verdict === 'indeterminate') {
    return `  ref <hidden>  INDETERMINATE — not visible to you`;
  }
  return `  ref ${t.alias}   ${verdictLabel(t.verdict)}${reasonSuffix(t)}`;
}

/** Human roll-up line for the final Verdict. */
function rollupLine(verdict: string): string {
  switch (verdict) {
    case 'allowed':
      return 'Verdict: ALLOWED';
    case 'conditional':
      return 'Verdict: CONDITIONAL (allowed if request-time conditions are met)';
    case 'denied':
      return 'Verdict: DENIED';
    default:
      return 'Verdict: INDETERMINATE (some referenced secrets are not visible to you)';
  }
}

export function registerCanDecryptCommand(secretCmd: Command): void {
  secretCmd
    .command('can-decrypt <id-or-alias>')
    .description(
      'Preflight: can an identity decrypt this secret and everything it references? (no value is read)',
    )
    .option('--as-api-key <id>', 'Simulate an API key identity (mutually exclusive with --as-user)')
    .option('--as-user <id>', 'Simulate a user identity (mutually exclusive with --as-api-key)')
    .option('--json', 'Output the raw verdict object as JSON')
    .addHelpText('after', `
Examples:
  znvault secret can-decrypt api/staging/config                      # can I decrypt it?
  znvault secret can-decrypt api/staging/config --as-api-key ak_123  # could this api-key?
  znvault secret can-decrypt api/staging/config --as-user user-42    # could this user?

Notes:
  - --as-api-key and --as-user are mutually exclusive; omit both to check yourself.
  - Simulating another identity requires the 'secret:simulate-access' permission.
  - This never decrypts or returns a value; it reads metadata + the reference graph only.
`)
    .action(async (idOrAlias: string, options: CanDecryptOptions) => {
      // Client-side mutual exclusion — reject before any network call.
      if (options.asApiKey && options.asUser) {
        output.error('--as-api-key and --as-user are mutually exclusive');
        process.exit(1);
      }

      const spinner = output.spinner('Resolving secret...').start();

      try {
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Checking decrypt authorization...';

        const body: { asApiKeyId?: string; asUserId?: string } = {};
        if (options.asApiKey) {
          body.asApiKeyId = options.asApiKey;
        } else if (options.asUser) {
          body.asUserId = options.asUser;
        }

        const result = await client.post<CanDecryptVerdict>(
          `/v1/secrets/${id}/can-decrypt`,
          body,
        );
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        const who =
          result.simulatedIdentity.kind === 'self'
            ? ''
            : ` (simulating ${result.simulatedIdentity.kind === 'apikey' ? 'api-key' : 'user'} ${result.simulatedIdentity.id ?? ''})`;

        console.log(`Can-decrypt: ${result.secret.alias}${who}`);
        console.log(`  secret          ${verdictLabel(result.self.verdict)}${reasonSuffix(result.self)}`);
        for (const t of result.targets) {
          console.log(renderTarget(t));
        }
        console.log(rollupLine(result.verdict));
      } catch (error) {
        spinner.fail('Failed to check decrypt authorization');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
