// Path: test/lib/ceremony/gates.test.ts
//
// The gates the ceremony refuses to advance past. Each one exists because of a
// specific way the ceremony can succeed while achieving nothing.
//
// They are pure functions on purpose: the command around them drives `hdiutil`,
// `ssh` and a USB device, none of which can be unit-tested, so everything that
// DECIDES anything lives here where it can be.

import { describe, expect, it } from 'vitest';
import { computeBskKcv } from '../../../src/lib/kcv.js';
import {
  assertKeyMatchesEnvelope,
  assertKeyMatchesExpectedKcv,
  assertDeviceIsExpectedCopy,
  assertNoOtherCeremonyRunning,
  type MountedDevice,
} from '../../../src/lib/ceremony/gates.js';

const KEY = Buffer.alloc(32, 0x7e);
const KCV = computeBskKcv(KEY);
const OTHER = Buffer.alloc(32, 0x11);

describe('assertKeyMatchesEnvelope — the gate that replaces --from-provider', () => {
  // `--from-provider` cannot be used from the operator's Mac: the Sentinel
  // listens only on the crypto VLAN and its allowlist is CN vault-1..5. What it
  // contributed was ONE thing — checking the key against the KCV PostgreSQL
  // recorded at wrap time, a value the source neither supplies nor can
  // influence. That check does not need the appliance. It needs the database.

  it('accepts a key whose KCV matches the recorded envelope', () => {
    expect(() => assertKeyMatchesEnvelope(KEY, { providerId: 'sentinel', kcv: KCV })).not.toThrow();
  });

  it('REFUSES a key that is not the one the envelope records', () => {
    // Without this, the ceremony escrows whatever it was handed. The bundle
    // would verify against itself perfectly and restore a key that opens
    // nothing in this deployment.
    expect(() =>
      assertKeyMatchesEnvelope(OTHER, { providerId: 'sentinel', kcv: KCV }),
    ).toThrow(/different key/i);
  });

  it('names both fingerprints', () => {
    let message = '';
    try {
      assertKeyMatchesEnvelope(OTHER, { providerId: 'sentinel', kcv: KCV });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(KCV);
    expect(message).toContain(computeBskKcv(OTHER));
  });

  it('REFUSES an envelope whose recorded KCV is malformed', () => {
    // `root_key_envelopes.kcv` is TEXT with no CHECK. A malformed value can
    // never equal a computed KCV, so without this the operator is sent chasing
    // "the key is wrong" when the real fault is a corrupt row.
    expect(() =>
      assertKeyMatchesEnvelope(KEY, { providerId: 'sentinel', kcv: 'deadbeef' }),
    ).toThrow(/kcv1:/);
  });

  it('REFUSES a key that is not 32 bytes before comparing anything', () => {
    expect(() =>
      assertKeyMatchesEnvelope(Buffer.alloc(16), { providerId: 'sentinel', kcv: KCV }),
    ).toThrow(/32 bytes/i);
  });
});

describe('assertKeyMatchesExpectedKcv — for the legacy BSK, which has no envelope', () => {
  // The legacy BSK (kcv1:8acdb385…) is covered by NO envelope: its only
  // protection is file permissions on five nodes, and it is the only key for
  // 1 200 retained backups from before 2026-05-17. Its anchor is therefore the
  // value recorded in the inventory and verified on three nodes, not a database
  // row.

  it('accepts a key matching the expected fingerprint', () => {
    expect(() => assertKeyMatchesExpectedKcv(KEY, KCV, 'legacy BSK')).not.toThrow();
  });

  it('REFUSES a mismatch and says which key it was checking', () => {
    let message = '';
    try {
      assertKeyMatchesExpectedKcv(OTHER, KCV, 'legacy BSK');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/legacy BSK/);
    expect(message).toContain(KCV);
  });
});

describe('assertDeviceIsExpectedCopy — the gate against writing B onto A', () => {
  // Both datAshur devices shipped with the SAME volume label, so they mounted
  // at the same path and which was which depended on plug order. Writing copy B
  // onto device A is silent: the filenames carry the copy label, so O_EXCL does
  // not fire, and the operator walks away with BOTH bundles on one device and
  // NONE on the other, believing there are two copies in two locations.
  //
  // The volume label is not the anchor either — it is a name, and it changed
  // when device A was reformatted. The USB serial is the stable identity.

  const deviceA: MountedDevice = {
    mountPoint: '/Volumes/ZNVAULT-A',
    usbSerial: 'SERIAL-COPY-A',
    volumeLabel: 'ZNVAULT-A',
  };

  it('accepts the device whose SERIAL matches the expected copy', () => {
    expect(() => assertDeviceIsExpectedCopy(deviceA, 'A', 'SERIAL-COPY-A')).not.toThrow();
  });

  it('REFUSES a device whose serial belongs to the other copy', () => {
    expect(() => assertDeviceIsExpectedCopy(deviceA, 'B', 'SERIAL-COPY-B')).toThrow(
      /serial/i,
    );
  });

  it('is NOT satisfied by a matching volume label alone', () => {
    // The trap in its purest form: someone relabels a device and the label now
    // lies. The serial is what the device says about itself.
    const impostor: MountedDevice = {
      mountPoint: '/Volumes/ZNVAULT-B',
      usbSerial: 'SERIAL-COPY-A', // actually device A
      volumeLabel: 'ZNVAULT-B',
    };
    expect(() => assertDeviceIsExpectedCopy(impostor, 'B', 'SERIAL-COPY-B')).toThrow();
  });

  it('REFUSES when the serial could not be read at all', () => {
    expect(() =>
      assertDeviceIsExpectedCopy({ ...deviceA, usbSerial: null }, 'A', 'SERIAL-COPY-A'),
    ).toThrow(/could not be read/i);
  });
});

describe('assertNoOtherCeremonyRunning', () => {
  it('accepts when nothing is in progress', () => {
    expect(() => assertNoOtherCeremonyRunning(null)).not.toThrow();
  });

  it('REFUSES when another key-lifecycle operation holds the slot', () => {
    // Two ceremonies at once, or a ceremony during an LMK rotation, is how the
    // inventory and the bundle end up describing different moments.
    expect(() =>
      assertNoOtherCeremonyRunning({
        operationId: 'abc',
        kind: 'LMK_ROTATION',
        phase: 'rewrap',
        ownerPrincipal: 'someone@example.com',
        startedAt: '2026-08-25T10:00:00Z',
      }),
    ).toThrow(/LMK_ROTATION/);
  });

  it('says who holds it and since when, so it can be chased', () => {
    let message = '';
    try {
      assertNoOtherCeremonyRunning({
        operationId: 'abc',
        kind: 'ESCROW_SNAPSHOT',
        phase: 'write-a',
        ownerPrincipal: 'someone@example.com',
        startedAt: '2026-08-25T10:00:00Z',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('someone@example.com');
    expect(message).toContain('2026-08-25T10:00:00Z');
    expect(message).toContain('write-a');
  });
});
