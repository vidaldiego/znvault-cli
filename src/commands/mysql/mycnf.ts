// src/commands/mysql/mycnf.ts
//
// Writes the short-lived 0600 my.cnf that carries the leased MySQL credentials
// (spec B2) and hands it to the child mysql as an OPEN FILE DESCRIPTOR rather
// than a path on disk.
//
// F1 (no plaintext directory entry survives the run) is achieved by the
// open → write → unlink-immediately pattern:
//   1. openSync(path, 'wx+', 0600)   → exclusive create, returns fd.
//   2. writeSync(fd, body)           → credentials written through the fd.
//   3. unlinkSync(path)              → directory entry removed AT ONCE. The
//      inode (and its plaintext bytes) stays alive ONLY because the open fd
//      still references it; there is NO name in the filesystem from this point
//      on, so a `kill -9` or crash leaves nothing on disk to recover.
//   4. runMysql passes `/dev/fd/<fd>` as --defaults-file and inherits the
//      fd into the child at the SAME number, so mysql re-opens the still-alive
//      inode through /dev/fd. (On macOS /dev/fd/N re-opens the inode — which is
//      why the fd MUST be readable; see the 'wx+' note below. On Linux /dev/fd
//      is /proc/self/fd and resolves the same inode.)
//   5. cleanup() closes the fd → last reference gone → kernel reclaims the
//      inode + its bytes. cleanup() is idempotent and best-effort.
//
// This replaces the old "spawn-then-unlink" approach, which raced: spawn()
// returns when the child is forked but BEFORE it has exec'd mysql and read the
// defaults file, so the unlink could win the race and mysql would die with
// "Failed to open required defaults file". Keeping the inode alive via an open
// fd removes the race entirely — the name is already gone before spawn, and the
// fd guarantees the bytes survive until cleanup().
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

function memBackedTmpBase(): string {
  // Prefer a memory-backed fs so the plaintext never hits spinning disk (spec F1).
  try {
    fs.accessSync('/dev/shm', fs.constants.W_OK);
    return '/dev/shm';
  } catch {
    return os.tmpdir();
  }
}

/**
 * The result of createMyCnf.
 *
 * - `fd`:     the open file descriptor backing the (now unlinked) my.cnf. The
 *             child mysql inherits this fd at the SAME number and re-opens it
 *             via `fdPath`.
 * - `fdPath`: `/dev/fd/<fd>` — pass this verbatim as the value of
 *             `--defaults-file`. Works on macOS (/dev/fd) and Linux
 *             (/dev/fd → /proc/self/fd).
 * - `cleanup`: idempotent, best-effort. Closes `fd` (releasing the inode so its
 *             bytes are reclaimed) and rmdir's the now-empty mem-fs dir.
 */
export interface MyCnfHandle {
  /** Open fd backing the unlinked cnf inode. Child inherits it at this number. */
  fd: number;
  /** `/dev/fd/<fd>` — the value to pass to --defaults-file. */
  fdPath: string;
  /** Idempotent best-effort teardown: closeSync(fd) + rmdir(dir). */
  cleanup: () => void;
}

/**
 * Create the temp my.cnf, unlink its directory entry immediately, and return an
 * open fd plus an idempotent cleanup().
 *
 * The body is fully synchronous (all fs operations are *Sync), but the function
 * returns a Promise to preserve the broker's `await createMyCnf(...)` contract
 * (and so it can become genuinely async later without touching callers).
 * Declared non-`async` + returning Promise.resolve avoids the require-await
 * lint warning while keeping the Promise return type (M-5).
 *
 * @throws If the exclusive create fails (e.g. EEXIST on a suffix collision,
 *         which is astronomically unlikely with 8 random bytes, or ENOSPC).
 */
export function createMyCnf(opts: {
  user: string; password: string; host: string; port: number;
}): Promise<MyCnfHandle> {
  const suffix = randomBytes(8).toString('hex');
  const dir = path.join(memBackedTmpBase(), `znvault-my-${suffix}`);
  // 0700 dir on a memory-backed fs (spec F1). Created before the file so the
  // file's parent is owner-only even for the brief moment the name exists.
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, 'my.cnf');
  const body = `[client]\nuser=${opts.user}\npassword=${opts.password}\nhost=${opts.host}\nport=${opts.port}\n`;

  // 'wx+' = O_RDWR | O_CREAT | O_EXCL, mode 0600.
  //   - O_EXCL  : fail if the file somehow already exists (no clobber / no
  //               following an attacker-planted symlink).
  //   - O_RDWR  : the fd MUST be READABLE. On macOS, `/dev/fd/N` RE-OPENS the
  //               underlying inode (it is not a plain dup of the open file
  //               description), so a write-only ('wx') fd would make mysql fail
  //               with EBADF/permission when it tries to read /dev/fd/N. O_RDWR
  //               keeps the inode re-openable for read by the child. Verified
  //               against real mysql 9.4 on macOS.
  let fd: number;
  try {
    fd = fs.openSync(file, 'wx+', 0o600);
  } catch (err) {
    // mkdir succeeded but open failed — drop the empty dir so we don't leak it.
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
    throw err;
  }

  let closed = false;
  try {
    // CRITICAL: write at an EXPLICIT position 0 (the 5-arg overload) so the fd's
    // current file OFFSET stays at 0. On macOS, `/dev/fd/N` does NOT give the
    // child a fresh offset-0 description — it shares the original fd's offset.
    // A plain `writeSync(fd, body)` advances the offset to EOF, so mysql reading
    // /dev/fd/N would start at EOF and parse an EMPTY defaults file (verified:
    // `mysql --print-defaults` shows zero args). Positioned writes do not move
    // the file pointer, so the offset remains 0 and mysql reads the whole body.
    const bodyBuf = Buffer.from(body, 'utf8');
    fs.writeSync(fd, bodyBuf, 0, bodyBuf.length, 0);
    // F1: remove the directory entry IMMEDIATELY. The inode stays alive purely
    // because `fd` is still open; there is no name on disk from here on.
    fs.unlinkSync(file);
  } catch (err) {
    // Writing or unlinking failed — don't leak the fd or the dir.
    try { fs.closeSync(fd); closed = true; } catch { /* ignore */ }
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
    throw err;
  }

  const cleanup = (): void => {
    // Closing the last fd referencing the (already unlinked) inode releases it,
    // so the kernel reclaims the plaintext bytes. Idempotent via `closed`.
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      closed = true;
    }
    // The file name is already gone; the dir should be empty. rmdir is
    // best-effort (it may already be gone if cleanup ran twice).
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  };

  return Promise.resolve({ fd, fdPath: `/dev/fd/${fd.toString()}`, cleanup });
}
