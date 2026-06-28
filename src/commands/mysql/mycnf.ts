// src/commands/mysql/mycnf.ts
//
// Writes the short-lived 0600 my.cnf that carries the leased MySQL credentials
// (spec B2). The plaintext lifetime is minimised in two layers:
//   - F1 primary: runMysql unlinks the directory entry IMMEDIATELY after it
//     spawns mysql (mysql reads --defaults-extra-file at startup), so no
//     plaintext entry survives the run and `kill -9` leaves nothing on disk.
//   - cleanup() backstop: best-effort shred + unlink + rmdir, idempotent, safe
//     to call even when the file is already gone (the common case once runMysql
//     has unlinked it).
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
 * Create the temp my.cnf and return its path plus an idempotent cleanup().
 *
 * The body is fully synchronous (all fs operations are *Sync), but the function
 * returns a Promise to preserve the broker's `await createMyCnf(...)` contract
 * (and so it can become genuinely async later without touching callers).
 * Declared non-`async` + returning Promise.resolve avoids the require-await
 * lint warning while keeping the Promise return type (M-5).
 */
export function createMyCnf(opts: {
  user: string; password: string; host: string; port: number;
}): Promise<{ path: string; cleanup: () => void }> {
  const suffix = randomBytes(8).toString('hex');
  const dir = path.join(memBackedTmpBase(), `znvault-my-${suffix}`);
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, 'my.cnf');
  const body = `[client]\nuser=${opts.user}\npassword=${opts.password}\nhost=${opts.host}\nport=${opts.port}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  const cleanup = (): void => {
    try {
      // Best-effort shred (no-op on tmpfs but harmless), then unlink + rmdir.
      // The file is usually already gone (runMysql unlinks after spawn — F1);
      // every step is wrapped so cleanup() is idempotent and never throws.
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size > 0) fs.writeFileSync(file, '\0'.repeat(size), { mode: 0o600 });
    } catch { /* ignore */ }
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  };
  return Promise.resolve({ path: file, cleanup });
}
