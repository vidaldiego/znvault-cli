// src/commands/mysql/mycnf.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function memBackedTmpBase(): string {
  // Prefer a memory-backed fs so the plaintext never hits spinning disk (spec F1).
  try {
    fs.accessSync('/dev/shm', fs.constants.W_OK);
    return '/dev/shm';
  } catch {
    return os.tmpdir();
  }
}

export async function createMyCnf(opts: {
  user: string; password: string; host: string; port: number;
}): Promise<{ path: string; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(memBackedTmpBase(), 'znvault-my-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'my.cnf');
  const body = `[client]\nuser=${opts.user}\npassword=${opts.password}\nhost=${opts.host}\nport=${opts.port}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  const cleanup = (): void => {
    try {
      // Best-effort shred (no-op on tmpfs but harmless), then unlink + rmdir.
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size > 0) fs.writeFileSync(file, '\0'.repeat(size), { mode: 0o600 });
    } catch { /* ignore */ }
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  };
  return { path: file, cleanup };
}
