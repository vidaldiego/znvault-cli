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

import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Command } from 'commander';

import * as output from '../lib/output.js';
import { KeyLifecycleClient, type CeremonyPhase } from '../lib/client/key-lifecycle.js';
import { client } from '../lib/client.js';
import { getVersion } from '../lib/version.js';
import {
  assertCeremonyIsOurs,
  assertCopyLabel,
  assertKeyMatchesEnvelope,
  assertKeyMatchesExpectedKcv,
  assertNoOtherCeremonyRunning,
  assertNotTheOtherCopy,
  assertRouteComplete,
  assertTransitionAllowed,
} from '../lib/ceremony/gates.js';
import { readAndVerifyLmkEscrowBundle } from '../lib/lmk-escrow.js';
import { assertRamBacked, assertTornDown, CEREMONY_MOUNT_POINT } from '../lib/ceremony/workspace.js';
import {
  createRamWorkspace,
  describeDevice,
  destroyRamWorkspace,
  indexingEnabled,
  listEscrowDevices,
} from '../lib/ceremony/system.js';

/**
 * Minimum vault release whose schema this command relies on (migration 093).
 *
 * 1.68.0 and not 1.67.x: migration 093 is not in 1.67.1. `schemaPresent()` is
 * the check that actually guards — this is what the record and the refusal
 * MESSAGE claim, and a message that names a release which does not carry the
 * table sends the reader to look in the wrong place.
 */
const MIN_RELEASE = '1.68.0';
const WORKSPACE_MB = 64;

interface StartOptions { json?: boolean }
interface CheckKeyOptions { againstEnvelope?: string; expectKcv?: string; label?: string }
interface CheckDeviceOptions { copy: string; serial: string }
interface ConfirmCopyOptions { copy: string; serial: string; bundle: string }
interface AbortOptions { reason: string; force?: boolean }

/**
 * Open the lifecycle client, refusing clearly if the server predates the routes.
 *
 * NO DATABASE. An earlier version of this command required `DATABASE_URL` and
 * wrote `key_lifecycle_operations` itself, which meant an SSH tunnel for an
 * ordinary operation and — worse — a custody record that never passed through
 * the server's authentication, authorisation or audit trail.
 */
async function lifecycle(): Promise<KeyLifecycleClient> {
  const ops = new KeyLifecycleClient();
  if (!(await ops.routesPresent())) {
    throw new Error(
      'This deployment does not expose the key-lifecycle routes, so a ceremony ' +
      `cannot be recorded. They arrive with zn-vault ${MIN_RELEASE}. Refusing to ` +
      'run an unrecorded ceremony — the record is the point.',
    );
  }
  return ops;
}

/** The in-flight ceremony, or a clear refusal. */
async function requireActive(
  ops: KeyLifecycleClient,
): Promise<NonNullable<Awaited<ReturnType<KeyLifecycleClient['active']>>>> {
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
  // Every fact the gates judge is gathered on THIS machine.
  assertCeremonyIsOurs(active, hostname());
  return active;
}

/**
 * Move to the next phase, refusing any move the route does not allow.
 *
 * The gate lives HERE rather than in each subcommand because an audit found the
 * subcommands each jumped to a fixed phase from wherever the ceremony happened
 * to be — so `start` then `teardown` then `finish` recorded a COMPLETED
 * ceremony that had done nothing at all. One choke point, and every caller
 * passes through it.
 */
async function advance(
  ops: KeyLifecycleClient,
  active: { operationId: string; epoch: number; phase: string },
  phase: CeremonyPhase,
  detail?: Record<string, unknown>,
): Promise<void> {
  assertTransitionAllowed(active.phase, phase);
  await ops.advance({
    operationId: active.operationId,
    expectedEpoch: active.epoch,
    phase,
    ...(detail ? { detail } : {}),
  });
}

/**
 * What was recorded for the most recent event of this phase.
 *
 * Reading the ceremony's OWN append-only record is the point: it is the one
 * source in reach that the operator cannot retype at the moment it is checked.
 */
async function recordedDetail(
  ops: KeyLifecycleClient,
  operationId: string,
  phase: CeremonyPhase,
): Promise<Record<string, unknown> | null> {
  const history = await ops.history(operationId);
  // The LAST event for the phase: `material` repeats, and a re-check supersedes
  // what it re-checked.
  const match = [...history].reverse().find((event) => event.phase === phase);
  return match?.detail ?? null;
}

function recordedString(detail: Record<string, unknown> | null, key: string): string | null {
  const value = detail?.[key];
  return typeof value === 'string' ? value : null;
}

/** The phase a copy is recorded under. */
function phaseForCopy(copy: 'A' | 'B'): CeremonyPhase {
  return copy === 'A' ? 'write-a' : 'write-b';
}

/**
 * The workspace device this ceremony proved to be RAM-backed.
 *
 * @throws if no workspace was ever recorded — which means there is nothing to
 *   tear down and the ceremony is not where the caller thinks it is.
 */
async function recordedWorkspaceDevice(
  ops: KeyLifecycleClient,
  operationId: string,
): Promise<string> {
  const device = recordedString(await recordedDetail(ops, operationId, 'workspace'), 'device');
  if (device === null) {
    throw new Error(
      'This ceremony has no recorded workspace, so there is no device that was ' +
      'ever proven to be RAM-backed. Nothing to tear down.',
    );
  }
  return device;
}

/**
 * Refuse a path that is not inside the RAM workspace.
 *
 * Checking a key that sits on the SSD and recording the 'material' phase for it
 * is a check that measured the wrong thing: the point of the phase is that the
 * material was handled in volatile memory.
 */
function assertInsideWorkspace(path: string, what: string): string {
  const absolute = resolve(path);
  if (absolute !== CEREMONY_MOUNT_POINT && !absolute.startsWith(`${CEREMONY_MOUNT_POINT}/`)) {
    throw new Error(
      `${what} is at ${absolute}, outside the ceremony workspace ` +
      `(${CEREMONY_MOUNT_POINT}). Key material is handled in the RAM volume and ` +
      'nowhere else; verifying a copy that lives somewhere else would record a ' +
      'precaution that was not taken.',
    );
  }
  return absolute;
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
    .option('--json', 'Output as JSON')
    .action(async (options: StartOptions) => {
      const ops = await lifecycle();
      // Not "is anything running?" then INSERT — that is the race the index
      // exists to close. But a friendly message beforehand costs nothing.
      assertNoOtherCeremonyRunning(await ops.active());

      // THE PRINCIPAL IS NOT SENT. The server records the authenticated
      // identity. This command used to pass `userInfo().username` — whatever
      // the local machine said — which made the "who" of a custody record a
      // value chosen by the person being recorded.
      const claimed = await ops.claim({
        kind: 'ESCROW_SNAPSHOT',
        phase: 'preflight',
        ownerNodeId: hostname(),
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
        // What the SERVER recorded, from the authenticated identity — not
        // whatever this machine's login name happens to be.
        operator: claimed.operation.ownerPrincipal,
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
          Operator: payload.operator,
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
    });

  // --------------------------------------------------------------- status ---
  ceremony
    .command('status')
    .description('Where the ceremony is, and the whole route it travelled')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const ops = await lifecycle();
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
    });

  // ------------------------------------------------------------ workspace ---
  ceremony
    .command('workspace')
    .description('Create the RAM-backed working volume, and PROVE it is in RAM')
    .action(async () => {
      const ops = await lifecycle();
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
    });

  // ------------------------------------------------------------ check-key ---
  ceremony
    .command('check-key <path>')
    .description('Verify a key file against its recorded fingerprint before it is escrowed')
    .option('--against-envelope <providerId>', "Compare against root_key_envelopes (e.g. 'sentinel')")
    .option('--expect-kcv <kcv1:...>', 'Compare against a known fingerprint (for the legacy BSK)')
    .option('--label <name>', 'What this key is, for the message', 'key')
    .action(async (path: string, options: CheckKeyOptions) => {
      if ((options.againstEnvelope === undefined) === (options.expectKcv === undefined)) {
        throw new Error('Pass exactly one of --against-envelope or --expect-kcv.');
      }
      const ops = await lifecycle();
      let key: Buffer | null = null;
      try {
        const active = await requireActive(ops);

        // The workspace was proven RAM-backed when it was CREATED, and the
        // process then exited. Minutes pass while material is copied in. If the
        // volume was unmounted in between, the mount point survives as an
        // ordinary directory on the SSD and quietly absorbs everything — the
        // documented failure, reintroduced as a check-then-use gap. So prove it
        // again, here, against the device this ceremony recorded.
        const absolute = assertInsideWorkspace(path, 'The key file');
        assertRamBacked(describeDevice(await recordedWorkspaceDevice(ops, active.operationId)));

        key = readFileSync(absolute);

        if (options.againstEnvelope !== undefined) {
          // Over the API, not the database. The KCV is publishable by
          // construction — a truncated HMAC under a dedicated label — and the
          // server already serves it; reading it out of `root_key_envelopes`
          // coupled this command to one engine and one schema for a value the
          // deployment publishes anyway.
          const status = await client.get<{ envelopes: Array<{ provider_id: string; kcv: string }> }>(
            '/v1/superadmin/rootkey/status',
          );
          const found = status.envelopes.find((e) => e.provider_id === options.againstEnvelope);
          const envelope = found === undefined
            ? null
            : { providerId: found.provider_id, kcv: found.kcv };
          if (envelope === null) {
            throw new Error(
              `No envelope recorded for provider '${options.againstEnvelope}'. Without it ` +
              'there is nothing to check the key against, and an unchecked key is how ' +
              'an escrow ends up holding the wrong one.',
            );
          }
          assertKeyMatchesEnvelope(key, envelope);
          output.success(`${options.label ?? 'key'} matches the '${envelope.providerId}' envelope (${envelope.kcv})`);
          // The KCV goes into the record, not just the message: an acta written
          // from this trail should not have to trust that someone read the
          // screen correctly. A KCV is publishable by construction.
          await advance(ops, active, 'material', {
            checked: options.label, against: envelope.providerId, kcv: envelope.kcv,
          });
        } else if (options.expectKcv !== undefined) {
          assertKeyMatchesExpectedKcv(key, options.expectKcv, options.label ?? 'key');
          output.success(`${options.label ?? 'key'} matches ${options.expectKcv}`);
          await advance(ops, active, 'material', {
            checked: options.label, against: 'recorded fingerprint', kcv: options.expectKcv,
          });
        }
      } finally {
        key?.fill(0);
      }
    });

  // --------------------------------------------------------- check-device ---
  //
  // A CHECK, and it no longer pretends to be more. The previous version looked
  // the device up BY the serial the operator typed and then "verified" that the
  // device it found had that serial — a tautology that could only ever pass,
  // while the failure it claimed to prevent (both bundles on one stick) stayed
  // wide open. What actually binds a copy to a device is `confirm-copy` below,
  // which compares against the serial already recorded for the other copy.
  ceremony
    .command('check-device')
    .description('Show whether the device you mean is mounted, before writing to it')
    .requiredOption('--copy <label>', 'Which copy this should be: A or B')
    .requiredOption('--serial <serial>', 'The USB serial recorded for that copy')
    .action(async (options: CheckDeviceOptions) => {
      const ops = await lifecycle();
      const active = await requireActive(ops);
      const copy = assertCopyLabel(options.copy);
      const devices = listEscrowDevices();
      const match = devices.find((d) => d.usbSerial === options.serial);
      if (match === undefined) {
        throw new Error(
          `No mounted device has USB serial ${options.serial}. Mounted: ` +
          `${devices.map((d) => `${d.mountPoint}=${d.usbSerial ?? '?'}`).join(', ') || '(none)'}.`,
        );
      }
      const other = copy === 'A' ? 'B' : 'A';
      assertNotTheOtherCopy(
        options.serial,
        copy,
        recordedString(await recordedDetail(ops, active.operationId, phaseForCopy(other)), 'serial'),
      );

      output.success(`${match.mountPoint} is mounted with serial ${options.serial}.`);
      output.info(
        `Write copy ${copy}: znvault superadmin lmk escrow snapshot --mount ` +
        `${match.mountPoint} --copy-label ${copy} …`,
      );
      output.info(
        `Then record it: ceremony confirm-copy --copy ${copy} --serial ${options.serial} ` +
        '--bundle <file on the device>',
      );
    });

  // --------------------------------------------------------- confirm-copy ---
  //
  // THE PHASE IS RECORDED AFTER THE WRITE, AND ONLY IF THE WRITE IS THERE.
  // Previously `check-device` advanced to write-a/write-b BEFORE anything was
  // written, and no command ever checked that a bundle had landed — so the trail
  // could read `write-a, write-b, teardown, COMPLETED` for a ceremony whose
  // devices were empty. The phases described intentions. Now they describe a
  // bundle that was read back OFF the device and verified.
  ceremony
    .command('confirm-copy')
    .description('Verify the bundle actually on the device, and record that copy')
    .requiredOption('--copy <label>', 'Which copy this is: A or B')
    .requiredOption('--serial <serial>', 'USB serial of the device it was written to')
    .requiredOption('--bundle <path>', 'The bundle file, on that device')
    .action(async (options: ConfirmCopyOptions) => {
      const ops = await lifecycle();
      const active = await requireActive(ops);
      const copy = assertCopyLabel(options.copy);

      const devices = listEscrowDevices();
      const match = devices.find((d) => d.usbSerial === options.serial);
      if (match === undefined) {
        throw new Error(
          `No mounted device has USB serial ${options.serial}, so there is nothing ` +
          'to verify. Plug in the device the bundle was written to.',
        );
      }

      const other = copy === 'A' ? 'B' : 'A';
      assertNotTheOtherCopy(
        options.serial,
        copy,
        recordedString(await recordedDetail(ops, active.operationId, phaseForCopy(other)), 'serial'),
      );

      // The bundle has to be ON the device. Verifying a copy that still sits
      // in the workspace would pass while the device stayed empty.
      const bundlePath = resolve(options.bundle);
      if (!bundlePath.startsWith(`${match.mountPoint}/`)) {
        throw new Error(
          `${bundlePath} is not on ${match.mountPoint}. The point of this step is ` +
          'that the bundle reached the device — a copy verified anywhere else ' +
          'leaves the device empty and the record saying otherwise.',
        );
      }

      const report = readAndVerifyLmkEscrowBundle(bundlePath);
      if (report.copyLabel.toUpperCase() !== copy) {
        throw new Error(
          `That bundle is labelled copy ${report.copyLabel}, not ${copy}. Writing ` +
          'it here would leave two copies with the same label and no way to tell ' +
          'from the bundles which device is missing.',
        );
      }

      await advance(ops, active, phaseForCopy(copy), {
        copy,
        serial: options.serial,
        mountPoint: match.mountPoint,
        bundlePath,
        bundleId: report.bundleId,
        bskKcv: report.bskKcv,
        recoverability: report.recoverability,
      });
      output.success(
        `Copy ${copy} verified on ${match.mountPoint}: bundle ${report.bundleId}, ` +
        `BSK ${report.bskKcv}, ${report.recoverability}.`,
      );
    });

  // --------------------------------------------------------------- verify ---
  //
  // Both copies, at the same time, on two different devices. `confirm-copy` can
  // only ever see one device at a time, so on its own it cannot rule out that
  // the second copy went onto the first stick after the first was unplugged.
  // This is the step that makes "two copies in two places" an observed fact.
  ceremony
    .command('verify')
    .description('Re-read BOTH bundles, from both devices, at the same time')
    .action(async () => {
      const ops = await lifecycle();
      const active = await requireActive(ops);

      const recorded = await Promise.all((['A', 'B'] as const).map(async (copy) => {
        const detail = await recordedDetail(ops, active.operationId, phaseForCopy(copy));
        const serial = recordedString(detail, 'serial');
        const bundlePath = recordedString(detail, 'bundlePath');
        if (serial === null || bundlePath === null) {
          throw new Error(
            `Copy ${copy} was never confirmed, so there is nothing to verify. Run ` +
            `'ceremony confirm-copy --copy ${copy} …' first.`,
          );
        }
        return { copy, serial, bundlePath };
      }));

      const [a, b] = recorded as [typeof recorded[0], typeof recorded[0]];
      if (a.serial === b.serial) {
        throw new Error(
          `Both copies were recorded against the same device (${a.serial}). That is ` +
          'one stick holding both bundles and another holding none.',
        );
      }

      const mounted = listEscrowDevices();
      const results = recorded.map((r) => {
        if (!mounted.some((d) => d.usbSerial === r.serial)) {
          throw new Error(
            `Copy ${r.copy} (serial ${r.serial}) is not mounted. Both devices must ` +
            'be present for this check — that is what it is for.',
          );
        }
        const report = readAndVerifyLmkEscrowBundle(r.bundlePath);
        return { ...r, bundleId: report.bundleId, bskKcv: report.bskKcv };
      });

      const [ra, rb] = results as [typeof results[0], typeof results[0]];
      if (ra.bskKcv !== rb.bskKcv) {
        throw new Error(
          `The two copies hold different bootstrap keys (${ra.bskKcv} and ` +
          `${rb.bskKcv}). One of them will not open this deployment.`,
        );
      }

      await advance(ops, active, 'verify', {
        copies: results.map((r) => ({ copy: r.copy, serial: r.serial, bundleId: r.bundleId })),
        bskKcv: ra.bskKcv,
      });
      output.success('Both copies verified, on two distinct devices, holding the same key.');
      output.table(
        ['Copy', 'USB serial', 'Bundle'],
        results.map((r) => [r.copy, r.serial, r.bundleId]),
      );
      output.info("Next: 'ceremony teardown' to destroy the RAM workspace.");
    });

  // ------------------------------------------------------------- teardown ---
  ceremony
    .command('teardown [device]')
    .description('Destroy the RAM workspace and PROVE it is gone')
    .action(async (device: string | undefined) => {
      const ops = await lifecycle();
      const active = await requireActive(ops);

      // THE DEVICE COMES FROM THE RECORD, not from argv. It used to come from
      // argv and was never compared with anything: a typo destroyed nothing,
      // reported success — `hdiutil detach` on a device that does not exist
      // fails quietly and the checks then observe that the nonexistent device
      // is indeed gone — and left the real RAM disk attached with the
      // bootstrap key in it. The optional argument is now only a cross-check.
      const recordedDevice = await recordedWorkspaceDevice(ops, active.operationId);
      if (device !== undefined && device !== recordedDevice) {
        throw new Error(
          `This ceremony's workspace is ${recordedDevice}, not ${device}. Tearing ` +
          `down ${device} would report success while ${recordedDevice} stayed ` +
          'attached with key material in it.',
        );
      }

      const facts = destroyRamWorkspace(recordedDevice);
      // Unmounting is not destroying: the RAM still holds the bytes and the
      // device can be remounted by anyone.
      assertTornDown(facts);
      await advance(ops, active, 'teardown', { device: recordedDevice });
      output.success(`${recordedDevice} unmounted and detached; the workspace is gone.`);
      output.info("Close the ceremony with 'ceremony finish'.");
    });

  // --------------------------------------------------------------- finish ---
  ceremony
    .command('finish')
    .description('Close the ceremony as COMPLETED')
    .action(async () => {
      const ops = await lifecycle();
      const active = await requireActive(ops);

      // Over the RECORDED ROUTE, not the current phase. Checking only "are we
      // at teardown?" let a ceremony that had done nothing but start and tear
      // down close as COMPLETED — and COMPLETED is the word somebody reads
      // years later, on the day the escrow is all that is left.
      const history = await ops.history(active.operationId);
      assertRouteComplete(history.map((e) => e.phase));

      const verified = await recordedDetail(ops, active.operationId, 'verify');
      await ops.finish({
        operationId: active.operationId,
        expectedEpoch: active.epoch,
        outcome: 'COMPLETED',
        ...(verified ? { detail: verified } : {}),
      });
      output.success(`Ceremony ${active.operationId} closed as COMPLETED.`);
      output.info('The bundle ids, the KCV and both serials are in the record: ceremony status.');
    });

  // ---------------------------------------------------------------- abort ---
  ceremony
    .command('abort')
    .description('Close the ceremony as ABANDONED, keeping the reason')
    .requiredOption('--reason <text>', 'Why it was abandoned — the next person will read this')
    .option('--force', 'Abandon even if the RAM workspace could not be destroyed')
    .action(async (options: AbortOptions) => {
      const ops = await lifecycle();
      const active = await requireActive(ops);

      // ABANDONING CLEANS UP, because nothing else can. Abandoning frees the
      // slot, and `teardown` needs an active ceremony — so an abort that left
      // the workspace behind would strand a mounted RAM volume holding the
      // bootstrap key with no command able to destroy it. The hint that used
      // to say "run teardown afterwards" was advice that could not be taken.
      const device = recordedString(
        await recordedDetail(ops, active.operationId, 'workspace'), 'device',
      );
      if (device !== null) {
        try {
          assertTornDown(destroyRamWorkspace(device));
          output.info(`RAM workspace ${device} destroyed.`);
        } catch (error) {
          if (options.force !== true) {
            throw new Error(
              `The ceremony has NOT been abandoned: its RAM workspace ${device} ` +
              'could not be destroyed, and abandoning would free the slot while ' +
              'leaving key material mounted with no command able to reach it. ' +
              `Deal with it by hand ('hdiutil detach ${device}'), then abort again. ` +
              'To abandon anyway, add --force. Underlying reason: ' +
              (error instanceof Error ? error.message : String(error)),
            );
          }
          output.warn(
            `Abandoning with --force: ${device} may still be attached WITH KEY ` +
            'MATERIAL IN IT. Destroy it by hand, now.',
          );
        }
      }

      await ops.finish({
        operationId: active.operationId,
        expectedEpoch: active.epoch,
        outcome: 'ABANDONED',
        error: options.reason,
      });
      output.warn(`Ceremony ${active.operationId} abandoned at phase '${active.phase}'.`);
      output.info('The slot is free and the workspace is gone.');
    });
}
