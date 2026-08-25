// Path: src/lib/ceremony/workspace.ts
//
// The scratch volume an escrow ceremony works in, and the proof that it is in
// RAM rather than on the disk.
//
// WHY A GATE AND NOT A CHECK OF THE RETURN CODE. Observed while building this,
// 2026-08-25:
//
//     $ diskutil mount ... /dev/disk34<TAB>       # malformed path
//     Failed to find disk /dev/disk34
//     $ head -c 32 /dev/urandom > /private/tmp/ceremony-ram/probe
//       32 bytes written: OK                      # on the SSD
//
// The mount point existed as an ordinary directory, so the write succeeded and
// nothing complained. Substitute the bootstrap key for random bytes and that is
// the root of the entire key hierarchy sitting on a general-purpose disk while
// the operator believes it is in volatile memory — undetectably, because
// everything downstream keeps working.
//
// The proximate cause was mundane (`tr -d ' '` does not strip the TABS that
// `hdiutil` emits). The lesson is not "use awk". It is that a workspace for key
// material must PROVE where it lives, from facts the system reports, rather
// than trust the exit status of the command that created it.
//
// HONEST LIMIT: macOS `ram://` is not Linux `tmpfs,noswap`. It is memory, but
// the system may page it. With FileVault, anything paged is encrypted at rest.
// This is stated in the ceremony protocol as a residual, not papered over.

/** Facts about the workspace device, as reported by the system. */
export interface DeviceFacts {
  /** e.g. `/dev/disk32` */
  device: string;
  /**
   * `image-path` from `hdiutil info`. `ram://<sectors>` for a RAM device, a
   * filesystem path for a disk image, `null` when hdiutil said nothing.
   */
  imagePath: string | null;
  /** Where `mount` says it is, or `null` if it is not mounted. */
  mountPoint: string | null;
}

export interface TeardownFacts {
  device: string;
  stillMounted: boolean;
  stillAttached: boolean;
}

/**
 * Where a ceremony workspace is allowed to live.
 *
 * Pinned so teardown can find it and so a workspace cannot be created on top of
 * an escrow device by a mistyped argument.
 */
export const CEREMONY_MOUNT_POINT = '/private/tmp/ceremony-ram';

/**
 * Refuse to proceed unless the workspace is demonstrably RAM-backed and mounted
 * where it is supposed to be.
 *
 * @throws with the observed facts named, because this aborts a ceremony that
 *   someone scheduled and possibly travelled for.
 */
export function assertRamBacked(facts: DeviceFacts): void {
  if (facts.imagePath === null) {
    throw new Error(
      `The backing of ${facts.device} could not be determined — 'hdiutil info' ` +
      'reported nothing for it. Absence of evidence is not evidence of RAM. ' +
      'Refusing to place key material here.',
    );
  }

  if (!facts.imagePath.startsWith('ram://')) {
    throw new Error(
      `${facts.device} is NOT backed by RAM: its image-path is ${facts.imagePath}, ` +
      'expected something beginning with ram://. A disk image on the SSD mounts ' +
      'and behaves identically, so image-path is the only thing that tells them ' +
      'apart. Refusing to place key material here.',
    );
  }

  if (facts.mountPoint === null) {
    throw new Error(
      `${facts.device} is ram-backed but NOT mounted. This is the dangerous case: ` +
      `if ${CEREMONY_MOUNT_POINT} exists as an ordinary directory, every write ` +
      'below succeeds and lands on the SSD, with nothing to indicate it. ' +
      'Refusing to proceed.',
    );
  }

  if (facts.mountPoint !== CEREMONY_MOUNT_POINT) {
    throw new Error(
      `Unexpected mount point: the workspace is at ${facts.mountPoint}, not ` +
      `${CEREMONY_MOUNT_POINT}. The location is pinned so teardown can find it, ` +
      'and so a mistyped argument cannot turn an escrow device into the workspace.',
    );
  }
}

/**
 * Refuse to close a ceremony while the workspace still exists.
 *
 * Unmounted is not destroyed: the RAM still holds the bytes and anyone can
 * remount the device. Both facts have to be false.
 */
export function assertTornDown(facts: TeardownFacts): void {
  if (facts.stillMounted) {
    throw new Error(
      `${facts.device} is still mounted. The workspace held key material; the ` +
      'ceremony is not closed until it is gone.',
    );
  }
  if (facts.stillAttached) {
    throw new Error(
      `${facts.device} is unmounted but still attached. Unmounting does not ` +
      'destroy it — the RAM still holds the bytes and the device can be ' +
      'remounted. Detach it before closing the ceremony.',
    );
  }
}
