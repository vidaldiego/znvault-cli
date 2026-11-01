import { Command } from 'commander';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ARCN1_HEADER_SIZE, decodeHeader, MAX_METADATA_BYTES } from '../../vendor/archon-recovery-core/index.js';
import { parseRecoveryJson } from '../../vendor/archon-recovery-core/json.js';
import { readMetadataSnapshot } from './local.js';

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
  for (const operation of ['verify', 'extract']) {
    recovery.command(operation).description('Unavailable until the complete recovery pipeline is connected')
      .option('--input <path>').option('--manifest <path>').option('--reference <path>')
      .option('--expect <path>', 'Selection explicitly chosen from prior independent custody')
      .option('--key-file <path>', 'Explicit protected local key file (repeatable)')
      .option('--output <path>')
      .action(() => { throw new Error(`recovery ${operation} is not yet available: complete recovery pipeline is not connected`); });
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
    const program = new Command().name('znvault');
    registerLocalRecoveryCommands(program);
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error: unknown) {
    console.error('Recovery error:', error instanceof Error ? error.message : 'Recovery failed');
    process.exitCode = 1;
  }
}
