// Path: src/lib/ceremony/system.ts
//
// Facts about this machine, gathered for the ceremony's gates to judge.
//
// This module DECIDES NOTHING. It shells out to `hdiutil`, `mount`, `ioreg` and
// `diskutil` and reports what they said; every refusal lives in `gates.ts` and
// `workspace.ts`, which are pure and therefore testable. The split is
// deliberate: this file cannot be unit-tested, so it must not be where the
// thinking happens.
//
// macOS-only by construction. The ceremony runs on the operator's Mac (see
// `docs/emergency-dr/PROTOCOLO-ceremonia-en-mac.md` for why that is the
// decision and what it costs); a Linux ceremony host would need its own
// implementation of exactly these five functions and nothing else.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { DeviceFacts, TeardownFacts } from './workspace.js';
import { CEREMONY_MOUNT_POINT } from './workspace.js';
import type { MountedDevice } from './gates.js';

/** Run a command and return stdout, or '' if it failed. Never throws. */
function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return '';
  }
}

/**
 * Create a RAM-backed volume and report what the system says about it.
 *
 * Returns facts rather than throwing on failure: `assertRamBacked` is what
 * refuses, and it must see the same facts an operator would — including the
 * case where the mount silently did not happen, which is the whole reason the
 * gate exists.
 *
 * `awk '{print $1}'` and NOT `tr -d ' '`: hdiutil pads the device path with
 * TABS, and stripping only spaces yields a malformed path whose mount fails
 * quietly while writes land on the SSD. That was a real hour of this build.
 */
export function createRamWorkspace(megabytes: number): DeviceFacts {
  const sectors = megabytes * 2048;
  const attached = run('hdiutil', ['attach', '-nomount', `ram://${String(sectors)}`]);
  const device = attached.trim().split(/\s+/)[0] ?? '';
  if (device === '') {
    return { device: '(hdiutil produced no device)', imagePath: null, mountPoint: null };
  }

  run('newfs_hfs', ['-v', 'CEREMONY', device]);
  if (!existsSync(CEREMONY_MOUNT_POINT)) mkdirSync(CEREMONY_MOUNT_POINT, { recursive: true });
  run('diskutil', ['mount', '-mountPoint', CEREMONY_MOUNT_POINT, device]);

  return describeDevice(device);
}

/** What `hdiutil info` and `mount` currently say about a device. */
export function describeDevice(device: string): DeviceFacts {
  let imagePath: string | null = null;
  let current: string | null = null;
  for (const line of run('hdiutil', ['info']).split('\n')) {
    if (line.startsWith('image-path')) {
      // `hdiutil info` prints `image-path : ram://131072`, colon and all. An
      // earlier version kept the colon and the gate refused a perfectly good
      // RAM volume — failing closed on a parsing bug, which is the right
      // direction, but still a bug.
      current = line.replace(/^image-path\s*:?\s*/, '').trim();
    } else if (line.trimStart().startsWith(device)) {
      imagePath = current;
    }
  }

  const mountLine = run('mount', []).split('\n').find((l) => l.startsWith(`${device} on `));
  const mountPoint = mountLine === undefined
    ? null
    : (/^\S+ on (.+?) \(/.exec(mountLine)?.[1] ?? null);

  return { device, imagePath, mountPoint };
}

/**
 * Unmount and detach, then report whether it worked.
 *
 * Reports rather than asserts, for the same reason as above: unmounting does
 * not destroy a RAM device, and `assertTornDown` is what insists on both.
 */
export function destroyRamWorkspace(device: string): TeardownFacts {
  run('diskutil', ['unmount', CEREMONY_MOUNT_POINT]);
  run('hdiutil', ['detach', device]);

  const stillMounted = run('mount', []).includes(`${device} on `);
  const stillAttached = run('hdiutil', ['info']).split('\n')
    .some((l) => l.trimStart().startsWith(device));
  return { device, stillMounted, stillAttached };
}

/**
 * Every mounted datAshur, with the USB serial that actually identifies it.
 *
 * The mapping matters more than it looks: both devices shipped with the same
 * volume label, so the mount path is not an identity. This walks the IO
 * registry to pair each BSD disk with the serial of the USB device it hangs
 * from — the same walk done by hand on 2026-08-25 to tell copy A from copy B.
 */
export function listEscrowDevices(): MountedDevice[] {
  const tree = run('ioreg', ['-p', 'IOService', '-n', 'datAshur PRO2', '-r', '-l', '-w', '0']);

  // Serial appears above the BSD names of the disks beneath it.
  const serialByDisk = new Map<string, string>();
  let serial: string | null = null;
  for (const line of tree.split('\n')) {
    const s = /"kUSBSerialNumberString"\s*=\s*"([^"]+)"/.exec(line);
    if (s?.[1] !== undefined) { serial = s[1]; continue; }
    const b = /"BSD Name"\s*=\s*"(disk\d+)"/.exec(line);
    if (b?.[1] !== undefined && serial !== null) serialByDisk.set(b[1], serial);
  }

  const devices: MountedDevice[] = [];
  for (const line of run('mount', []).split('\n')) {
    const m = /^\/dev\/(disk\d+)s\d+ on (.+?) \(/.exec(line);
    if (m === null) continue;
    // Neither group is optional, so a successful match guarantees both.
    const [, whole, mountPoint] = m as unknown as [string, string, string];
    if (!mountPoint.startsWith('/Volumes/')) continue;
    const serialForDisk = serialByDisk.get(whole);
    if (serialForDisk === undefined) continue;   // not a datAshur
    devices.push({
      mountPoint,
      usbSerial: serialForDisk,
      volumeLabel: mountPoint.slice('/Volumes/'.length),
    });
  }
  return devices;
}

/** Is Spotlight indexing this path? Ceremony hygiene, reported not enforced. */
export function indexingEnabled(path: string): boolean | null {
  const out = run('mdutil', ['-s', path]);
  if (out === '') return null;
  if (/Indexing enabled/i.test(out)) return true;
  if (/Indexing disabled|not (?:supported|eligible)/i.test(out)) return false;
  return null;
}
