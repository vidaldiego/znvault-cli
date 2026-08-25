// Path: znvault-cli/src/commands/lmk-ceremony.ts
//
// `znvault superadmin lmk escrow ceremony` — the escrow ceremony as a command
// rather than a script.
//
// WHY A COMMAND. A script goes stale, gets edited without a trace, and if it
// dies halfway it leaves nothing behind. A command is versioned, released and
// tested — and, more to the point, it can write to `key_lifecycle_operations`
// (zn-vault migration 093) who ran the ceremony, when, and how far it got.
//
// WHAT IT DOES AND DOES NOT DO. It owns the state machine and the gates. It
// does NOT copy key material for you: fetching the legacy BSK, the mini-CA and
// the Sentinel configuration is `ssh` and `scp`, and wrapping that in a CLI
// would add a large, fragile surface for no safety. The operator performs those
// copies into the RAM workspace; the command refuses to advance until it has
// verified the result.
//
// That division is the honest one. The command can only guarantee what it can
// check, and what it can check is exactly where a ceremony fails silently:
// a workspace that is not really in RAM, a key that is not really the right
// key, a device that is not really the copy you think.

import { hostname, userInfo } from 'node:os';
import { readFileSync } from 'node:fs';
import { type Command } from 'commander';

import * as output from '../lib/output.js';
import { LocalDBClient, isLocalDbAvailable } from '../lib/db/index.js';
import { KeyLifecycleOperations, type CeremonyPhase } from '../lib/db/key-lifecycle.js';
import { getVersion } from '../lib/version.js';
import {
  assertDeviceIsExpectedCopy,
  assertKeyMatchesEnvelope,
  assertKeyMatchesExpectedKcv,
  assertNoOtherCeremonyRunning,
} from '../lib/ceremony/gates.js';
import { assertRamBacked, assertTornDown, CEREMONY_MOUNT_POINT } from '../lib/ceremony/workspace.js';
import {
  createRamWorkspace,
  describeDevice,
  destroyRamWorkspace,
  indexingEnabled,
  listEscrowDevices,
} from '../lib/ceremony/system.js';

/** Minimum vault release whose schema this command relies on (migration 093). */
const MIN_RELEASE = '1.67.0';
const WORKSPACE_MB = 64;

interface StartOptions { operator?: string; json?: boolean }
interface CheckKeyOptions { againstEnvelope?: string; expectKcv?: string; label?: string }
interface CheckDeviceOptions { copy: string; serial: string }
interface AbortOptions { reason: string }

function requireLocalDb(): void {
  if (!isLocalDbAvailable()) {
    throw new Error(
      'The ceremony is local-only: it needs direct PostgreSQL access to read the ' +
      'root-key envelopes and to record the operation. Set DATABASE_URL (an SSH ' +
      'tunnel to the cluster is fine) and try again.',
    );
  }
}

/** Open the lifecycle store, refusing clearly if the schema is not deployed. */
async function lifecycle(): Promise<KeyLifecycleOperations> {
  const ops = new KeyLifecycleOperations();
  if (!(await ops.schemaPresent())) {
    await ops.close();
    throw new Error(
      'This deployment has no key_lifecycle_operations table, so a ceremony cannot ' +
      `be recorded. It arrives with zn-vault migration 093 (release ${MIN_RELEASE}). ` +
      'Refusing to run an unrecorded ceremony — the record is the point.',
    );
  }
  return ops;
}

/** The in-flight ceremony, or a clear refusal. */
async function requireActive(
  ops: KeyLifecycleOperations,
): Promise<NonNullable<Awaited<ReturnType<KeyLifecycleOperations['active']>>>> {
  const active = await ops.active();
  if (active === null) {
    throw new Error("No ceremony is in progress. Start one with 'ceremony start'.");
  }
  if (active.kind !== 'ESCROW_SNAPSHOT') {
    throw new Error(
      `The operation in progress is a ${active.kind}, not a ceremony. Do not run a ` +
      'ceremony alongside it: the bundle and the inventory would describe ' +
      'different moments.',
    );
  }
  return active;
}

async function advance(
  ops: KeyLifecycleOperations,
  active: { operationId: string; epoch: number },
  phase: CeremonyPhase,
  detail?: Record<string, unknown>,
): Promise<void> {
  await ops.advance({
    operationId: active.operationId,
    expectedEpoch: active.epoch,
    phase,
    nodeId: hostname(),
    ...(detail ? { detail } : {}),
  });
}

export function registerLmkCeremonyCommands(escrow: Command): void {
  const ceremony = escrow
    .command('ceremony')
    .description(
      'Escrow ceremony with recorded state and enforced gates. Records who ran ' +
      'it, when, and how far it got, in key_lifecycle_operations.',
    );

  // ---------------------------------------------------------------- start ---
  ceremony
    .command('start')
    .description('Claim the ceremony slot and run the preflight gates')
    .option('--operator <who>', 'Who is performing it (defaults to the login name)')
    .option('--json', 'Output as JSON')
    .action(async (options: StartOptions) => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        // Not "is anything running?" then INSERT — that is the race the index
        // exists to close. But a friendly message beforehand costs nothing.
        assertNoOtherCeremonyRunning(await ops.active());

        const operator = options.operator ?? userInfo().username;
        const claimed = await ops.claim({
          phase: 'preflight',
          ownerNodeId: hostname(),
          ownerPrincipal: operator,
          minRelease: MIN_RELEASE,
          detail: { cliVersion: getVersion() },
        });
        if (!claimed.ok) {
          assertNoOtherCeremonyRunning(claimed.active);
          throw new Error('The ceremony slot was taken between the check and the claim.');
        }

        const devices = listEscrowDevices();
        const payload = {
          operationId: claimed.operation.operationId,
          operator,
          host: hostname(),
          cliVersion: getVersion(),
          devices: devices.map((d) => ({
            mountPoint: d.mountPoint,
            usbSerial: d.usbSerial,
            volumeLabel: d.volumeLabel,
            indexing: indexingEnabled(d.mountPoint),
          })),
        };

        if (options.json === true) {
          output.json(payload);
        } else {
          output.section('Escrow ceremony started');
          output.keyValue({
            Operation: payload.operationId,
            Operator: operator,
            Host: payload.host,
            CLI: payload.cliVersion,
          });
          if (devices.length === 0) {
            output.warn('No datAshur device is mounted. Unlock and mount both before continuing.');
          } else {
            output.table(
              ['Mount point', 'USB serial', 'Label', 'Spotlight'],
              payload.devices.map((d) => [
                d.mountPoint,
                d.usbSerial ?? '(unreadable)',
                d.volumeLabel,
                d.indexing === true ? 'INDEXING — turn it off' : d.indexing === false ? 'off' : 'unknown',
              ]),
            );
          }
          output.info("Next: 'ceremony workspace' to create the RAM-backed working volume.");
        }
      } finally {
        await ops.close();
      }
    });

  // --------------------------------------------------------------- status ---
  ceremony
    .command('status')
    .description('Where the ceremony is, and the whole route it travelled')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await ops.active();
        if (active === null) {
          if (options.json === true) output.json({ active: null });
          else output.info('No ceremony or other key-lifecycle operation is in progress.');
          return;
        }
        const history = await ops.history(active.operationId);
        if (options.json === true) {
          output.json({ active, history });
          return;
        }
        output.section(`In progress: ${active.kind}`);
        output.keyValue({
          Operation: active.operationId,
          Phase: active.phase,
          Operator: active.ownerPrincipal,
          Host: active.ownerNodeId,
          Started: active.startedAt,
        });
        output.table(
          ['#', 'Phase', 'State', 'At'],
          history.map((e) => [String(e.seq), e.phase, e.state, e.at]),
        );
      } finally {
        await ops.close();
      }
    });

  // ------------------------------------------------------------ workspace ---
  ceremony
    .command('workspace')
    .description('Create the RAM-backed working volume, and PROVE it is in RAM')
    .action(async () => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await requireActive(ops);
        const facts = createRamWorkspace(WORKSPACE_MB);

        // The gate, not the return code. A failed mount leaves the mount point
        // as an ordinary directory and every write below lands on the SSD,
        // silently. See workspace.ts.
        assertRamBacked(facts);

        await advance(ops, active, 'workspace', { device: facts.device, imagePath: facts.imagePath });
        output.success(`Workspace ready at ${CEREMONY_MOUNT_POINT} (${facts.device}, ${facts.imagePath ?? '?'})`);
        output.info(
          'Copy the key material INTO this directory and nowhere else, then check ' +
          "each item with 'ceremony check-key'.",
        );
      } finally {
        await ops.close();
      }
    });

  // ------------------------------------------------------------ check-key ---
  ceremony
    .command('check-key <path>')
    .description('Verify a key file against its recorded fingerprint before it is escrowed')
    .option('--against-envelope <providerId>', "Compare against root_key_envelopes (e.g. 'sentinel')")
    .option('--expect-kcv <kcv1:...>', 'Compare against a known fingerprint (for the legacy BSK)')
    .option('--label <name>', 'What this key is, for the message', 'key')
    .action(async (path: string, options: CheckKeyOptions) => {
      requireLocalDb();
      if ((options.againstEnvelope === undefined) === (options.expectKcv === undefined)) {
        throw new Error('Pass exactly one of --against-envelope or --expect-kcv.');
      }
      const ops = await lifecycle();
      const db = new LocalDBClient();
      let key: Buffer | null = null;
      try {
        const active = await requireActive(ops);
        key = readFileSync(path);

        if (options.againstEnvelope !== undefined) {
          const envelope = await db.getRootKeyEnvelope(options.againstEnvelope);
          if (envelope === null) {
            throw new Error(
              `No envelope recorded for provider '${options.againstEnvelope}'. Without it ` +
              'there is nothing to check the key against, and an unchecked key is how ' +
              'an escrow ends up holding the wrong one.',
            );
          }
          assertKeyMatchesEnvelope(key, envelope);
          output.success(`${options.label ?? 'key'} matches the '${envelope.providerId}' envelope (${envelope.kcv})`);
          await advance(ops, active, 'material', { checked: options.label, against: envelope.providerId });
        } else if (options.expectKcv !== undefined) {
          assertKeyMatchesExpectedKcv(key, options.expectKcv, options.label ?? 'key');
          output.success(`${options.label ?? 'key'} matches ${options.expectKcv}`);
          await advance(ops, active, 'material', { checked: options.label, against: 'recorded fingerprint' });
        }
      } finally {
        key?.fill(0);
        await db.close();
        await ops.close();
      }
    });

  // --------------------------------------------------------- check-device ---
  ceremony
    .command('check-device')
    .description('Confirm the mounted device is the copy you think, by USB serial')
    .requiredOption('--copy <label>', 'Which copy this should be, e.g. A or B')
    .requiredOption('--serial <serial>', 'The USB serial recorded for that copy')
    .action(async (options: CheckDeviceOptions) => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await requireActive(ops);
        const devices = listEscrowDevices();
        const match = devices.find((d) => d.usbSerial === options.serial);
        if (match === undefined) {
          throw new Error(
            `No mounted device has USB serial ${options.serial}. Mounted: ` +
            `${devices.map((d) => `${d.mountPoint}=${d.usbSerial ?? '?'}`).join(', ') || '(none)'}.`,
          );
        }
        assertDeviceIsExpectedCopy(match, options.copy, options.serial);

        const phase: CeremonyPhase = options.copy.toUpperCase() === 'B' ? 'write-b' : 'write-a';
        await advance(ops, active, phase, { copy: options.copy, mountPoint: match.mountPoint });
        output.success(`${match.mountPoint} is copy ${options.copy} (serial ${options.serial})`);
        output.info(
          `Write the bundle with: znvault superadmin lmk escrow snapshot --mount ${match.mountPoint} ` +
          `--copy-label ${options.copy} …`,
        );
      } finally {
        await ops.close();
      }
    });

  // ------------------------------------------------------------- teardown ---
  ceremony
    .command('teardown <device>')
    .description('Destroy the RAM workspace and PROVE it is gone')
    .action(async (device: string) => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await requireActive(ops);
        const facts = destroyRamWorkspace(device);
        // Unmounting is not destroying: the RAM still holds the bytes and the
        // device can be remounted by anyone.
        assertTornDown(facts);
        await advance(ops, active, 'teardown', { device });
        output.success(`${device} unmounted and detached; the workspace is gone.`);
        output.info("Finish with 'ceremony finish' once both copies verify.");
      } finally {
        await ops.close();
      }
    });

  // --------------------------------------------------------------- finish ---
  ceremony
    .command('finish')
    .description('Close the ceremony as COMPLETED')
    .action(async () => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await requireActive(ops);
        if (active.phase !== 'teardown') {
          throw new Error(
            `The ceremony is at phase '${active.phase}', not 'teardown'. The workspace ` +
            'held key material; closing before it is destroyed would record a ' +
            'completion that is not true.',
          );
        }
        const workspace = describeDevice('');
        void workspace;
        await ops.finish({
          operationId: active.operationId,
          expectedEpoch: active.epoch,
          outcome: 'COMPLETED',
          nodeId: hostname(),
        });
        output.success(`Ceremony ${active.operationId} closed as COMPLETED.`);
        output.info('Record the bundle ids, both KCVs and the device serials in the acta.');
      } finally {
        await ops.close();
      }
    });

  // ---------------------------------------------------------------- abort ---
  ceremony
    .command('abort')
    .description('Close the ceremony as ABANDONED, keeping the reason')
    .requiredOption('--reason <text>', 'Why it was abandoned — the next person will read this')
    .action(async (options: AbortOptions) => {
      requireLocalDb();
      const ops = await lifecycle();
      try {
        const active = await requireActive(ops);
        await ops.finish({
          operationId: active.operationId,
          expectedEpoch: active.epoch,
          outcome: 'ABANDONED',
          nodeId: hostname(),
          error: options.reason,
        });
        output.warn(`Ceremony ${active.operationId} abandoned at phase '${active.phase}'.`);
        output.info(
          'The slot is free. If a RAM workspace is still mounted, destroy it with ' +
          "'ceremony teardown <device>' — abandoning does not clean up for you.",
        );
      } finally {
        await ops.close();
      }
    });
}
