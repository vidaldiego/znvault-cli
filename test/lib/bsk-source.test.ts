// Path: test/lib/bsk-source.test.ts
//
// Where `escrow snapshot` gets the bootstrap key from.
//
// Until now: a file, and only a file. That forced the escrow ceremony to run on
// a machine that already holds the cleartext key — in practice a production
// application node — and it made the escrow a ONE-WAY DOOR: once `lmk.bin` is
// retired from the fleet, no further snapshot could ever be taken, so a damaged
// or lost datAshur would be unrecoverable.
//
// With a provider source the key comes from the Archon Sentinel over mTLS, so
// the ceremony can run on a dedicated host that never stores the key, and the
// escrow stays repeatable after the file is gone.
//
// THE GATE THAT MAKES THIS SAFE. A file source is self-evidencing: the bytes on
// disk are the key or they are not. A network source is not — something answered
// an HTTPS request. If that answer is wrong, for any reason from a
// misconfigured appliance to a hostile one, the bundle would be built around
// the wrong key, and every internal consistency check in the bundle would pass,
// because the bundle is consistent with ITSELF. The escrow would verify
// perfectly and restore a key that opens nothing.
//
// So the returned key is checked against the KCV that PostgreSQL recorded when
// the envelope was wrapped — a value the appliance does not supply and cannot
// influence at read time. Same check the server makes in
// `sentinel-provider.ts` before serving a boot.

import { describe, expect, it } from 'vitest';
import { computeBskKcv } from '../../src/lib/kcv.js';
import { resolveBskFromProvider, type EnvelopeRow } from '../../src/lib/bsk-source.js';

/** A fixed synthetic key. Never a real one. */
const KEY = Buffer.alloc(32, 0x7e);
const KCV = computeBskKcv(KEY);
const OTHER_KEY = Buffer.alloc(32, 0x11);

function envelope(overrides: Partial<EnvelopeRow> = {}): EnvelopeRow {
  return {
    providerId: 'sentinel',
    providerType: 'sentinel',
    keyId: 'tpm:example',
    ciphertext: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    kcv: KCV,
    ...overrides,
  };
}

/** An unwrap that returns exactly what it is told to. */
function returning(key: Buffer): (ciphertext: Buffer) => Promise<Buffer> {
  return async () => Buffer.from(key);
}

describe('resolveBskFromProvider', () => {
  it('returns the key when the appliance opens the envelope to the recorded KCV', async () => {
    const key = await resolveBskFromProvider(envelope(), returning(KEY));

    expect(key.equals(KEY)).toBe(true);
  });

  it('REFUSES a key whose KCV disagrees with the envelope', async () => {
    // The whole reason this function exists. Everything downstream would accept
    // the wrong key: the bundle would wrap it, verify against itself, and
    // restore a key that opens nothing in this deployment.
    await expect(resolveBskFromProvider(envelope(), returning(OTHER_KEY))).rejects.toThrow(
      /KCV/i,
    );
  });

  it('names both fingerprints in the refusal', async () => {
    // A ceremony is a scheduled event with a witness and an acta. "Mismatch"
    // alone is not something anyone can act on at the time.
    let message = '';
    try {
      await resolveBskFromProvider(envelope(), returning(OTHER_KEY));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(KCV);
    expect(message).toContain(computeBskKcv(OTHER_KEY));
  });

  it('REFUSES a key that is not 32 bytes, before computing anything from it', async () => {
    await expect(
      resolveBskFromProvider(envelope(), returning(Buffer.alloc(16, 0x7e))),
    ).rejects.toThrow(/32 bytes/i);
  });

  it('REFUSES an envelope whose recorded KCV is not a kcv1: fingerprint', async () => {
    // `root_key_envelopes.kcv` is TEXT with no CHECK constraint. A malformed
    // value can never equal a computed KCV, so the comparison would fail with a
    // confusing "mismatch" when the real fault is a corrupt row.
    await expect(
      resolveBskFromProvider(
        envelope({ kcv: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }),
        returning(KEY),
      ),
    ).rejects.toThrow(/kcv1:/);
  });

  it('wipes the key it received when it refuses it', async () => {
    // The rejected key is still key material — a real key from a different
    // deployment, or the right key from a corrupt row. It does not get to
    // linger in the heap because the comparison failed.
    const handed = Buffer.from(OTHER_KEY);
    await expect(
      resolveBskFromProvider(envelope(), async () => handed),
    ).rejects.toThrow();

    expect(handed.equals(Buffer.alloc(32))).toBe(true);
  });

  it('does not let the caller keep a reference to the buffer the transport used', async () => {
    // The caller zeroizes what it is given. If that were the same buffer the
    // transport still holds, the wipe would be someone else's problem too, and
    // the ownership of the wipe stops being clear.
    const fromTransport = Buffer.from(KEY);
    const key = await resolveBskFromProvider(envelope(), async () => fromTransport);

    expect(key.equals(KEY)).toBe(true);
    key.fill(0);
    expect(fromTransport.equals(Buffer.alloc(32))).toBe(true);
  });

  it('propagates a transport failure instead of dressing it as a key problem', async () => {
    // An unreachable appliance is an operational fact for the ceremony log, not
    // evidence about the key.
    await expect(
      resolveBskFromProvider(envelope(), async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
