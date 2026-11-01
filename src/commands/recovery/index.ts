import { Command } from 'commander';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ARCN1_HEADER_SIZE, decodeHeader, MAX_METADATA_BYTES } from '../../vendor/archon-recovery-core/index.js';
import { parseRecoveryJson } from '../../vendor/archon-recovery-core/json.js';
import { readMetadataSnapshot, runRecoveryOperation, type LocalRecoveryOptions } from './local.js';

interface InspectOptions { input: string; manifest: string; reference?: string }

export function registerLocalRecoveryCommands(program: Command): void {
  const recovery = program.command('recovery').description('Offline backup metadata inspection and recovery');
  recovery.command('inspect').description('Inspect public metadata and ARCN1 header; does not authenticate or decrypt')
    .requiredOption('--input <path>', 'Explicit local ARCN1 dump')
    .requiredOption('--manifest <path>', 'Public manifest JSON (maximum 1 MiB)')
    .option('--reference <path>', 'Historical public reference JSON (maximum 1 MiB)')
    .action(async (options: InspectOptions) => {
      const snapshot = await readMetadataSnapshot(options.manifest, MAX_METADATA_BYTES);
      const metadata: unknown = parseRecoveryJson(snapshot.bytes, MAX_METADATA_BYTES);
      if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) throw new Error('Manifest must be a JSON object');
      const manifest = metadata as Record<string, unknown>;
      const reference = options.reference ? await readMetadataSnapshot(options.reference, MAX_METADATA_BYTES) : null;
      if (reference) parseRecoveryJson(reference.bytes, MAX_METADATA_BYTES);
      const input = await open(options.input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await input.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Input must be a regular file without links');
        const buffer = Buffer.alloc(ARCN1_HEADER_SIZE);
        const { bytesRead } = await input.read(buffer, 0, buffer.length, 0);
        const header = decodeHeader(buffer.subarray(0, bytesRead));
        console.log(JSON.stringify({ authenticated: false, scope: 'public metadata and structural header only; ciphertext not verified', format: 'arcn1', version: header.version, metadataSha256: snapshot.sha256, referenceSha256: reference?.sha256 ?? null, companionDeclared: Object.hasOwn(manifest, 'recoveryCompanion') }));
      } finally { await input.close(); }
    });
  for (const operation of ['verify', 'extract'] as const) {
    recovery.command(operation).description(operation === 'verify' ? 'Authenticate the complete set and codecs; discard provisional plaintext' : 'Authenticate the complete set and publish a new private directory')
      .option('--input <path>', 'Explicit local dump, including a read-only Mimir copy/mount')
      .option('--companion-input <path>', 'Explicit local companion when declared')
      .option('--s3-config <path>', 'Protected explicit S3 transport JSON; verified TLS and exact Head/Get only')
      .requiredOption('--manifest <path>', 'Manifest JSON, maximum 1 MiB')
      .option('--reference <path>', 'Custodied historical exact reference JSON')
      .requiredOption('--expect <path>', 'Selection explicitly chosen from prior independent custody')
      .requiredOption('--key-file <path>', 'Protected raw 32-byte KEK; repeat up to 32 times', (path: string, paths: string[]) => [...paths,path], [])
      .option('--output <path>', 'NEW_PATH under a trusted existing parent; exclusively reserved 0700')
      .option('--max-input-bytes <bytes>', 'Total ciphertext bound, default 1 TiB')
      .option('--max-expanded-bytes <bytes>', 'Expanded set bound, default 1 TiB')
      .option('--max-expansion-ratio <ratio>', 'Dump expansion ratio bound, default 10000')
      .option('--json', 'Public result only (all results are JSON)')
      .option('--debug', 'Retain safe public diagnostics; never plaintext or keys')
      .addHelpText('after', '\nBounds: 64 KiB queues; zstd window <=8 MiB; 64 MiB free-space floor; companion JSON <=1 MiB, ciphertext <=1 MiB+33, members <=128 KiB. No SQL import/application restore. NEW_PATH is reserved exclusively; residual workspaces are never resumed.')
      .action(async (options: LocalRecoveryOptions) => runRecoveryOperation(operation, options));
  }
}

export async function runLocalRecovery(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    // Refuse connected options anywhere before the delimiter. Environment profile,
    // URL, local-mode and plugin/update settings never configure this command graph.
    const forbidden = new Set(['--profile', '--url', '--insecure', '--local', '--key-source', '--backup', '--tls-spki-sha256']);
    for (const arg of argv) {
      if (arg === '--') break;
      if (forbidden.has(arg.split('=')[0])) throw new Error(`${arg.split('=')[0]} is incompatible with offline recovery`);
    }
    const program = new Command().name('znvault').exitOverride().configureOutput({ writeErr: () => { /* parser diagnostics can contain untrusted argument values */ } });
    registerLocalRecoveryCommands(program);
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error: unknown) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'commander.helpDisplayed') return;
    const incompatible = error instanceof Error && /^--(?:profile|url|insecure|local|key-source|backup|tls-spki-sha256) is incompatible with offline recovery$/.test(error.message);
    console.error(incompatible && error instanceof Error ? error.message : 'Recovery error: recovery_failed');
    process.exitCode = 1;
  }
}
