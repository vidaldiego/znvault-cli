// Path: src/lib/bsk-source.ts
//
// Obtain the bootstrap key for an escrow ceremony from a root-key provider
// instead of from a cleartext file.
//
// WHY THIS EXISTS. `escrow snapshot` could only read `DATA_DIR/lmk.bin`, which
// had two consequences neither of which is acceptable as an operational
// control:
//
//   The ceremony had to run wherever the cleartext key already lives — in
//   practice a production application node, with a USB device plugged into it.
//   That is defensible only as "no NEW exposure"; it is not how a key ceremony
//   is supposed to look, and it is not defensible to an auditor.
//
//   The escrow was a ONE-WAY DOOR. Retiring `lmk.bin` from the fleet — the
//   declared goal of the whole programme — would permanently remove the ability
//   to take another snapshot. A damaged datAshur, a lost one, a third copy for
//   a new location: none of them possible, ever again.
//
// Sourcing from the Archon Sentinel over mTLS fixes both. The appliance is the
// hardware root; a dedicated ceremony host asks it to open the envelope, writes
// the bundle straight to the device, and stores nothing.
//
// THE GATE. A file is self-evidencing — the bytes are the key or they are not.
// A network answer is not: something replied to an HTTPS request. If that reply
// is wrong for ANY reason, the bundle is built around the wrong key and every
// check inside it still passes, because a bundle is only ever checked against
// itself. The escrow would verify perfectly and restore a key that opens
// nothing.
//
// So the answer is checked against the KCV PostgreSQL recorded when the
// envelope was wrapped — a value the appliance neither supplies nor can
// influence at read time. This mirrors `sentinel-provider.ts` on the server,
// which makes the identical check before serving a boot.

import { computeBskKcv, isBskKcv } from './kcv.js';

/** A row of `root_key_envelopes`. */
export interface EnvelopeRow {
  providerId: string;
  providerType: string;
  keyId: string | null;
  ciphertext: Buffer;
  /** Publishable KCV recorded at wrap time. The anchor for the check below. */
  kcv: string;
}

/** Opens one envelope. The transport; anything that can answer. */
export type UnwrapFn = (ciphertext: Buffer) => Promise<Buffer>;

const BSK_LEN = 32;

/**
 * Ask a provider to open its envelope, and refuse anything that is not the key
 * the envelope says it is.
 *
 * @returns a FRESH buffer the caller owns and must zeroize.
 * @throws when the envelope row is malformed, the answer is the wrong length,
 *   or the answer's KCV disagrees with the recorded one.
 */
export async function resolveBskFromProvider(
  envelope: EnvelopeRow,
  unwrap: UnwrapFn,
): Promise<Buffer> {
  // Checked BEFORE the network call: a malformed recorded KCV can never equal a
  // computed one, so leaving it would surface a corrupt row as a "the appliance
  // returned the wrong key" mismatch — sending the ceremony after the wrong
  // fault, with the device already unlocked and a witness in the room.
  if (!isBskKcv(envelope.kcv)) {
    throw new Error(
      `Envelope for provider '${envelope.providerId}' records a KCV that is not a ` +
      `kcv1: fingerprint (${JSON.stringify(envelope.kcv)}). The row in ` +
      'root_key_envelopes is malformed; this is a database problem, not an ' +
      'appliance problem. Do not proceed with the ceremony.',
    );
  }

  // A transport failure is an operational fact, not evidence about the key.
  // It travels up unchanged.
  const answered = await unwrap(envelope.ciphertext);

  // Copy immediately, then wipe the transport's buffer. The caller must own
  // exactly one buffer and be the only party responsible for wiping it;
  // handing back the transport's own memory leaves the duty ambiguous.
  const key = Buffer.from(answered);
  answered.fill(0);

  try {
    if (key.length !== BSK_LEN) {
      throw new Error(
        `Provider '${envelope.providerId}' opened its envelope to ` +
        `${String(key.length)} bytes; a bootstrap key is exactly ` +
        `${String(BSK_LEN)} bytes. The envelope is corrupt.`,
      );
    }

    const actual = computeBskKcv(key);
    if (actual !== envelope.kcv) {
      throw new Error(
        `Provider '${envelope.providerId}' opened its envelope to a DIFFERENT key ` +
        `than the one recorded when it was wrapped. Envelope records ` +
        `${envelope.kcv}; the appliance returned ${actual}. Refusing to build an ` +
        'escrow bundle around it: the bundle would verify against itself and ' +
        "restore a key that opens nothing. Run 'znvault superadmin rootkey verify' " +
        'and stop the ceremony.',
      );
    }
  } catch (error) {
    // Rejected key material does not linger in the heap because a comparison
    // failed. It is still a real key — from another deployment, or this one
    // under a corrupt row.
    key.fill(0);
    throw error;
  }

  return key;
}
