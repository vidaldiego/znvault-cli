// Path: src/lib/ceremony/gates.ts
//
// The gates an escrow ceremony refuses to advance past.
//
// Every one of them exists because of a specific way the ceremony can SUCCEED
// while achieving nothing — which is the failure mode that matters here, since
// nobody opens an escrow bundle until the day everything else is already gone.
//
// Pure functions on purpose. The command around them drives `hdiutil`, `ssh`
// and a USB device, none of which can be unit-tested; everything that DECIDES
// anything lives here.

import { computeBskKcv, isBskKcv } from '../kcv.js';

const BSK_LEN = 32;

/** A row of `root_key_envelopes`, reduced to what a gate needs. */
export interface EnvelopeRef {
  providerId: string;
  /** Publishable KCV recorded at wrap time. The anchor. */
  kcv: string;
}

/** A mounted escrow device, as the system reports it. */
export interface MountedDevice {
  mountPoint: string;
  /** USB serial — the stable identity. `null` if it could not be read. */
  usbSerial: string | null;
  /** Volume label. A NAME, not an identity: it changes when reformatted. */
  volumeLabel: string;
}

/** An in-flight key-lifecycle operation (migration 093). */
export interface ActiveOperation {
  operationId: string;
  kind: string;
  phase: string;
  ownerPrincipal: string;
  startedAt: string;
}

/**
 * The gate that replaces `--from-provider` when the appliance is unreachable.
 *
 * `--from-provider` cannot run from the operator's Mac: the Sentinel listens
 * only on the crypto VLAN and its allowlist is CN `vault-1..5`. But what it
 * contributed was ONE thing — checking the key against the KCV PostgreSQL
 * recorded when the envelope was wrapped, a value the source neither supplies
 * nor can influence at read time.
 *
 * That check does not need the appliance. It needs the database. So it survives
 * the topology.
 *
 * Without it, the ceremony escrows whatever it was handed: the bundle would
 * verify against itself perfectly and restore a key that opens nothing here.
 *
 * @throws naming both fingerprints.
 */
export function assertKeyMatchesEnvelope(key: Buffer, envelope: EnvelopeRef): void {
  if (!isBskKcv(envelope.kcv)) {
    throw new Error(
      `The envelope for provider '${envelope.providerId}' records a KCV that is not ` +
      `a kcv1: fingerprint (${JSON.stringify(envelope.kcv)}). The row in ` +
      'root_key_envelopes is malformed — this is a database problem, not a key ' +
      'problem. Do not proceed.',
    );
  }
  if (key.length !== BSK_LEN) {
    throw new Error(
      `A bootstrap key is exactly ${String(BSK_LEN)} bytes; this one is ${String(key.length)} bytes.`,
    );
  }

  const actual = computeBskKcv(key);
  if (actual !== envelope.kcv) {
    throw new Error(
      `The key does not match what provider '${envelope.providerId}' recorded: it is a ` +
      `DIFFERENT key. Envelope records ${envelope.kcv}; the key provided is ${actual}. ` +
      'Refusing to build an escrow bundle around it — the bundle would verify ' +
      'against itself and restore a key that opens nothing in this deployment.',
    );
  }
}

/**
 * The same check for a key that has no envelope to anchor against.
 *
 * The legacy BSK is covered by NO provider: its only protection is file
 * permissions on five nodes, and it is the only key for the retained backups
 * from before the 2026-05-17 cutover. Its anchor is therefore the fingerprint
 * recorded in the custody inventory and verified independently on three nodes.
 *
 * @param label what is being checked, so a failure names it.
 */
export function assertKeyMatchesExpectedKcv(
  key: Buffer,
  expectedKcv: string,
  label: string,
): void {
  if (!isBskKcv(expectedKcv)) {
    throw new Error(`The expected fingerprint for the ${label} is not a kcv1: value.`);
  }
  if (key.length !== BSK_LEN) {
    throw new Error(
      `The ${label} must be ${String(BSK_LEN)} bytes, got ${String(key.length)}.`,
    );
  }
  const actual = computeBskKcv(key);
  if (actual !== expectedKcv) {
    throw new Error(
      `The ${label} does not match its recorded fingerprint. Expected ${expectedKcv}, ` +
      `got ${actual}. Either the wrong file was fetched, or the key on the node has ` +
      'changed — both are reasons to stop the ceremony, not to continue.',
    );
  }
}

// REMOVED, 2026-08-25, after an independent audit: `assertDeviceIsExpectedCopy`.
//
// It compared a device's USB serial against a serial the operator had typed —
// but the command found the device BY that serial first, so the mismatch branch
// was unreachable and the gate could only ever pass. It was pure, it was
// tested, and it decided nothing. Its replacement is `assertNotTheOtherCopy`
// below, which compares against the serial this ceremony already RECORDED for
// the other copy: a value the operator cannot retype at the moment of the check.
//
// The lesson is not about this function. A gate is only as good as what it is
// handed, and a test that feeds it inputs the caller can never produce will
// stay green forever while the door stands open.

/**
 * Refuse to start while another key-lifecycle operation holds the slot.
 *
 * Two ceremonies at once, or a ceremony during an LMK rotation, is how the
 * inventory and the bundle end up describing different moments. The database
 * enforces the exclusion (migration 093's partial unique index); this turns the
 * resulting 23505 into something an operator can act on.
 */
export function assertNoOtherCeremonyRunning(active: ActiveOperation | null): void {
  if (active === null) return;
  throw new Error(
    `Another key-lifecycle operation is in progress: ${active.kind}, phase ` +
    `'${active.phase}', held by ${active.ownerPrincipal} since ${active.startedAt} ` +
    `(operation ${active.operationId}). Finish or abandon it before starting a ` +
    'ceremony — two operations at once make the bundle and the inventory ' +
    'describe different moments.',
  );
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------
//
// ADDED AFTER AN INDEPENDENT AUDIT, 2026-08-25. The first version of this
// command had gates but no route: every subcommand jumped to a fixed phase from
// ANY phase, and `finish` asked only "are we at teardown?". So this worked, with
// no error at any step:
//
//     ceremony start        -> preflight
//     ceremony teardown …   -> teardown
//     ceremony finish       -> COMPLETED
//
// A ceremony that created no workspace, checked no key, touched no device, and
// wrote no bundle — recorded as COMPLETED in the one place anybody will look
// years later. The gates were pure, tested and entirely bypassable, which is
// worse than not having them: the record inspires confidence it has not earned.

/** The phases of a ceremony, in the only order they are allowed to occur. */
export const CEREMONY_ROUTE = [
  'preflight',
  'workspace',
  'material',
  'write-a',
  'write-b',
  'verify',
  'teardown',
] as const;

export type RoutePhase = (typeof CEREMONY_ROUTE)[number];

/**
 * Which phase may follow which.
 *
 * `material` repeats because a ceremony checks several keys (the current BSK,
 * the legacy BSK, the mini-CA) and each one is a separate check. Nothing else
 * repeats: writing copy A twice means something is wrong that a re-run should
 * not paper over.
 *
 * TEARDOWN IS REACHABLE FROM EVERYWHERE, and that is not a hole. The first
 * version of this table allowed it only after `verify`, which deadlocked the
 * exact case it most needed to serve: a ceremony abandoned at `material` has a
 * RAM volume with key material in it, and refusing to tear it down leaves the
 * bootstrap key mounted with no command able to destroy it. Destroying the
 * workspace is always safe and always desirable. What must never be reachable
 * early is COMPLETED — and that is enforced separately, by
 * `assertRouteComplete`, which asks the recorded history rather than the
 * current phase.
 */
const ALLOWED_NEXT: Record<RoutePhase, readonly RoutePhase[]> = {
  preflight: ['workspace', 'teardown'],
  workspace: ['material', 'teardown'],
  material: ['material', 'write-a', 'teardown'],
  'write-a': ['write-b', 'teardown'],
  'write-b': ['verify', 'teardown'],
  verify: ['teardown'],
  teardown: [],
};

function isRoutePhase(phase: string): phase is RoutePhase {
  return (CEREMONY_ROUTE as readonly string[]).includes(phase);
}

/**
 * Refuse a phase that does not follow the one the ceremony is actually in.
 *
 * @throws naming both phases and what is expected next, because the operator is
 *   mid-ceremony and needs to know where they are, not merely that they are wrong.
 */
export function assertTransitionAllowed(from: string, to: string): void {
  if (!isRoutePhase(from)) {
    throw new Error(
      `The ceremony is at an unrecognised phase '${from}'. Refusing to move it: ` +
      'the record would stop describing anything. Inspect the operation by hand.',
    );
  }
  if (!isRoutePhase(to)) {
    throw new Error(`'${to}' is not a phase of a ceremony.`);
  }
  const allowed = ALLOWED_NEXT[from];
  if (!allowed.includes(to)) {
    const next = allowed.length === 0
      ? 'nothing — the ceremony is at its last phase and can only be closed'
      : allowed.map((p) => `'${p}'`).join(' or ');
    throw new Error(
      `A ceremony cannot go from '${from}' to '${to}'. What follows '${from}' is ` +
      `${next}. Skipping a phase does not skip the work — it only removes it ` +
      'from the record.',
    );
  }
}

/**
 * Refuse to close a ceremony that did not travel the whole route.
 *
 * The check is over the RECORDED history rather than the current phase, so a
 * ceremony that reached teardown by a path that skipped both writes is refused
 * at the last moment even if every individual transition were somehow allowed.
 *
 * @param recorded every phase in `key_lifecycle_phase_events`, in order.
 */
export function assertRouteComplete(recorded: readonly string[]): void {
  const seen = new Set(recorded);
  const missing = CEREMONY_ROUTE.filter((p) => !seen.has(p));
  if (missing.length > 0) {
    throw new Error(
      `This ceremony never reached ${missing.map((p) => `'${p}'`).join(', ')}. ` +
      'Closing it as COMPLETED would record two escrow copies that were never ' +
      'written or never verified — and nobody opens an escrow bundle until the ' +
      'day everything else is already gone. Abandon it instead, with the reason: ' +
      "'ceremony abort --reason …'.",
    );
  }
}

/**
 * Normalise and check a copy label.
 *
 * There are exactly two copies. An unrecognised label used to fall through to
 * copy A, so a typo silently corrupted the trail rather than stopping.
 */
export function assertCopyLabel(label: string): 'A' | 'B' {
  const upper = label.trim().toUpperCase();
  if (upper !== 'A' && upper !== 'B') {
    throw new Error(
      `'${label}' is not a copy: there are exactly two, A and B. A label that is ` +
      'neither would be recorded against a phase it does not belong to.',
    );
  }
  return upper;
}

/**
 * Refuse to write both copies to the same physical device.
 *
 * THE GATE THIS REPLACES DID NOTHING. It compared the device's serial against a
 * serial the operator had just typed — after the device had been LOOKED UP by
 * that same serial. The mismatch branch was unreachable; the gate could only
 * ever pass. What it claimed to prevent therefore remained wide open: write copy
 * A to a device, then copy B to the same device, and the operator walks away
 * with both bundles on one stick and none on the other, believing there are two
 * copies in two locations.
 *
 * The fix is to compare against something the operator cannot supply at this
 * moment: the serial ALREADY RECORDED for the other copy, read back from the
 * append-only phase events of this same ceremony.
 *
 * @param serial the device about to be written.
 * @param otherCopySerial what this ceremony recorded for the other copy, or
 *   `null` if that copy has not been written yet.
 */
export function assertNotTheOtherCopy(
  serial: string,
  copy: 'A' | 'B',
  otherCopySerial: string | null,
): void {
  if (otherCopySerial === null) return;
  if (serial === otherCopySerial) {
    throw new Error(
      `This is the same physical device as copy ${copy === 'A' ? 'B' : 'A'} ` +
      `(USB serial ${serial}). Both bundles would sit on one stick and the other ` +
      'would hold nothing, with no error at any step and nothing in the record ' +
      'to show it. The two copies exist to be in two places: plug in the other ' +
      'device.',
    );
  }
}

/**
 * Refuse to drive a ceremony that belongs to another machine.
 *
 * The state lives in the cluster database, so any host with DATABASE_URL can
 * reach any ceremony — and every fact this command checks is gathered LOCALLY.
 * Run `teardown` against another Mac's ceremony and `hdiutil detach` finds
 * nothing, `mount` reports nothing, and the teardown gate passes: it truthfully
 * observes that the device is absent HERE while the real RAM volume stays
 * mounted THERE, with the bootstrap key in it. The check that fixed the argv
 * problem does not survive the wrong host, so the host has to be checked too.
 *
 * A ceremony is a single-machine procedure by construction: one operator, one
 * RAM volume, two devices in their hands.
 */
export function assertCeremonyIsOurs(
  active: { ownerNodeId: string; ownerPrincipal: string },
  thisNodeId: string,
): void {
  if (active.ownerNodeId !== thisNodeId) {
    throw new Error(
      `This ceremony is being run on ${active.ownerNodeId} by ${active.ownerPrincipal}, ` +
      `and you are on ${thisNodeId}. Every check this command makes — the RAM ` +
      'volume, the mounted devices, the teardown — is about the machine it runs ' +
      'on, so from here they would describe the wrong computer and pass. Work on ' +
      `${active.ownerNodeId}, or have that ceremony abandoned first.`,
    );
  }
}
