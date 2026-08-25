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

/**
 * Refuse to write to a device that is not the copy the operator intends.
 *
 * THE FAILURE THIS PREVENTS IS SILENT. Both datAshur devices shipped with the
 * same volume label, so they mounted at the same path and which was which
 * depended on plug order. Writing copy B onto device A produces no error: the
 * filenames carry the copy label, so `O_EXCL` never fires, and the operator
 * walks away with BOTH bundles on one device and NONE on the other, believing
 * there are two copies in two locations.
 *
 * The volume label is not the anchor either — it is a name, and device A's
 * changed when it was reformatted. **The USB serial is the identity.**
 */
export function assertDeviceIsExpectedCopy(
  device: MountedDevice,
  copyLabel: string,
  expectedSerial: string,
): void {
  if (device.usbSerial === null || device.usbSerial === '') {
    throw new Error(
      `The USB serial of the device at ${device.mountPoint} could not be read. The ` +
      'serial is the only stable identity — the volume label is a name that ' +
      'changes when the device is reformatted. Refusing to write without it.',
    );
  }
  if (device.usbSerial !== expectedSerial) {
    throw new Error(
      `Wrong device for copy ${copyLabel}: ${device.mountPoint} has USB serial ` +
      `${device.usbSerial}, but copy ${copyLabel} is ${expectedSerial}. Writing here ` +
      'would put two bundles on one device and none on the other, with nothing ' +
      'to indicate it. Check which device is plugged in.',
    );
  }
}

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
