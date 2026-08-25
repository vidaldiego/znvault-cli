// Path: test/lib/ceremony/workspace.test.ts
//
// The RAM-backed workspace, and the gate that exists because I walked into the
// trap while building it.
//
// A failed RAM-disk mount DEGRADES SILENTLY TO THE SSD. Observed 2026-08-25:
//
//     $ diskutil mount ... /dev/disk34<TAB>
//     Failed to find disk /dev/disk34
//     $ head -c 32 /dev/urandom > /private/tmp/ceremony-ram/probe
//       escritura de 32 B: OK          ← "OK". On the SSD.
//
// The mount point existed as an ordinary directory, so the write succeeded and
// nothing complained. With the bootstrap key instead of random bytes, that is
// the root key on a general-purpose disk while the operator believes it is in
// RAM — and it would never be noticed, because everything downstream works.
//
// (The proximate cause was mundane: `tr -d ' '` does not remove the TABS that
// `hdiutil` emits, so the device path was malformed. The lesson is not "use
// awk"; it is that a workspace for key material must PROVE it is in RAM rather
// than assume the mount worked.)
//
// So `assertRamBacked` does not ask "did it mount?". It asks "is this device
// backed by ram://, AND is it mounted?", and both come from the system, not
// from the return code of the command that created it.

import { describe, expect, it } from 'vitest';
import {
  assertRamBacked,
  assertTornDown,
  type DeviceFacts,
} from '../../../src/lib/ceremony/workspace.js';

const ok: DeviceFacts = {
  device: '/dev/disk32',
  imagePath: 'ram://131072',
  mountPoint: '/private/tmp/ceremony-ram',
};

describe('assertRamBacked', () => {
  it('accepts a device that is ram-backed AND mounted', () => {
    expect(() => assertRamBacked(ok)).not.toThrow();
  });

  it('REFUSES a device that is not mounted', () => {
    // The observed failure: the device exists, the directory exists, and
    // writes land on the SSD.
    expect(() => assertRamBacked({ ...ok, mountPoint: null })).toThrow(/not mounted/i);
  });

  it('REFUSES a device backed by a file instead of RAM', () => {
    // A disk image on the SSD mounts identically and behaves identically.
    // Only `image-path` tells them apart.
    expect(() =>
      assertRamBacked({ ...ok, imagePath: '/Users/someone/scratch.dmg' }),
    ).toThrow(/ram:\/\//);
  });

  it('REFUSES when the backing is unknown', () => {
    // `hdiutil info` had nothing to say about this device. Absence of evidence
    // is not evidence of RAM.
    expect(() => assertRamBacked({ ...ok, imagePath: null })).toThrow(/could not be determined/i);
  });

  it('names the device and what it found, because this aborts a ceremony', () => {
    let message = '';
    try {
      assertRamBacked({ ...ok, imagePath: '/tmp/x.dmg' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('/dev/disk32');
    expect(message).toContain('/tmp/x.dmg');
  });

  it('refuses a mount point outside the expected location', () => {
    // A workspace mounted somewhere unexpected is a workspace whose teardown
    // will not find it.
    expect(() =>
      assertRamBacked({ ...ok, mountPoint: '/Volumes/ZNVAULT-A' }),
    ).toThrow(/mount point/i);
  });
});

describe('assertTornDown', () => {
  it('accepts a workspace that is gone from both mount and hdiutil', () => {
    expect(() =>
      assertTornDown({ device: '/dev/disk32', stillMounted: false, stillAttached: false }),
    ).not.toThrow();
  });

  it('REFUSES a device still mounted', () => {
    expect(() =>
      assertTornDown({ device: '/dev/disk32', stillMounted: true, stillAttached: false }),
    ).toThrow(/still mounted/i);
  });

  it('REFUSES a device detached from the filesystem but still attached', () => {
    // Unmounted is not destroyed: the RAM still holds the bytes and the device
    // can be remounted by anyone. The ceremony is not over until the device is
    // gone.
    expect(() =>
      assertTornDown({ device: '/dev/disk32', stillMounted: false, stillAttached: true }),
    ).toThrow(/still attached/i);
  });
});
