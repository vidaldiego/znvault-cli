// Path: src/lib/restore-drill.ts
//
// The two gates of the isolated-restore drill.
//
// THE DRILL'S FAILURE MODE IS SUCCESS. If the restored database ends up with no
// LMK version above zero, `initializeFromPG()` reads "no ACTIVE version" and
// takes the legitimate first-boot path: `bootstrapInitialLMKVersion()` mints a
// brand-new LMK, wraps it under the bootstrap key on disk, inserts version 1,
// and the vault comes up healthy. `/v1/health` answers 200 with `status: 'ok'`
// and a root key whose KCV even MATCHES the escrow bundle — the BSK really was
// restored from it. Every signal an operator would look at says the drill
// passed. What actually happened is that a new key hierarchy was created over
// an empty database, and the only thing the drill exists to demonstrate — that
// this bundle brings back THIS deployment's keys — was never exercised.
//
// So neither gate may read an exit code or an HTTP status. Degraded root-key
// resolution returns 200 with the degradation reported inside the body, and a
// null resolution state omits the `rootKey` block entirely while still
// returning 200 and `status: 'ok'`. Both gates read state and compare it
// against what the bundle says, and both explain themselves: a failed drill is
// investigated cold, hours later, by someone who was not there.
//
// Pure functions on purpose. The orchestration around them drives docker from a
// shell script and cannot be unit-tested, so everything that DECIDES anything
// lives here where it can be.

/** One row of the restored `lmk_versions` table. */
export interface RestoredLmkVersion {
  version: number;
  status: string;
  hasWrappedLmk: boolean;
}

/** Shape of `/v1/health` this drill depends on. Deliberately permissive. */
export interface HealthBody {
  status?: string;
  rootKey?: {
    provider?: string;
    kcv?: string;
    degraded?: boolean;
  };
}

export interface BootedOnRestoredKeysInput {
  health: HealthBody;
  versionsAfterBoot: RestoredLmkVersion[];
  /** `bskKcv` from the escrow bundle's verification report. */
  expectedBskKcv: string;
  /** `activeLmkVersion` from the escrow bundle's verification report. */
  expectedActiveVersion: number;
}

/**
 * Versions at or below zero are not real key generations.
 *
 * `models.postgres.sql` seeds `version=0, status='ACTIVE',
 * key_id='ZK_MODE_PLACEHOLDER'` on every boot. Counting it would make a
 * correctly restored database look like it has two ACTIVE versions.
 */
function positives(versions: RestoredLmkVersion[]): RestoredLmkVersion[] {
  return versions.filter((v) => v.version > 0);
}

function describe(versions: RestoredLmkVersion[]): string {
  const rows = positives(versions);
  if (rows.length === 0) return '(no versions above zero)';
  return rows
    .map((v) => `v${String(v.version)} ${v.status}${v.hasWrappedLmk ? '' : ' [no material]'}`)
    .join(', ');
}

/**
 * Gate 1, run BEFORE the vault is started against the restored database.
 *
 * Before, not after, because once the vault mints a replacement LMK the
 * evidence of what went wrong is overwritten: the table then holds a perfectly
 * ordinary version 1 with material, and nothing distinguishes it from a
 * successful restore except that it is the wrong key.
 *
 * @throws with a diagnosis whenever the database could not have come from the
 *   deployment the bundle describes.
 */
export function assertRestoredDatabaseIsRecoverable(
  versions: RestoredLmkVersion[],
  expectedActiveVersion: number,
): void {
  const rows = positives(versions);

  if (rows.length === 0) {
    throw new Error(
      'The restored database holds no LMK version above zero. Starting a vault ' +
      'against it would NOT fail: it would take the first-boot path, MINT a new ' +
      'LMK, and report a completely healthy start — the drill would pass having ' +
      'restored nothing. Check that the database dump was actually applied and ' +
      'that it came from the same snapshot as the escrow bundle.',
    );
  }

  const recoverable = rows.filter((v) => v.hasWrappedLmk);
  if (recoverable.length === 0) {
    throw new Error(
      `The restored database holds ${String(rows.length)} LMK version(s) above zero ` +
      `but none has wrapped material (${describe(versions)}). The inventory came ` +
      'back and the key material did not, which reaches the same mint-a-new-key ' +
      'path as an empty table.',
    );
  }

  const actives = rows.filter((v) => v.status === 'ACTIVE');
  if (actives.length !== 1) {
    throw new Error(
      `The restored database has ${String(actives.length)} ACTIVE LMK version(s) ` +
      `above zero (${describe(versions)}); exactly one is required. A drill run ` +
      'against an ambiguous key state proves nothing about either version.',
    );
  }

  const active = actives.at(0);
  if (active === undefined) throw new Error('unreachable: one ACTIVE row expected');

  if (!active.hasWrappedLmk) {
    throw new Error(
      `The ACTIVE LMK version ${String(active.version)} has no wrapped material. ` +
      'The vault cannot unwrap the current key from this database.',
    );
  }

  if (active.version !== expectedActiveVersion) {
    throw new Error(
      `The restored database is ACTIVE on LMK version ${String(active.version)}, but ` +
      `the escrow bundle was taken when version ${String(expectedActiveVersion)} was ` +
      'active. The bundle and the dump are from different moments, so a successful ' +
      'boot would say nothing about either of them.',
    );
  }
}

/**
 * Gate 2, run AFTER the vault has started.
 *
 * Confirms three separate things, because each can be true while the others are
 * not: the node resolved the key the bundle carries, it did so cleanly, and it
 * did NOT create anything new to do it.
 *
 * WHAT THIS GATE CANNOT DO, measured on a bench rather than assumed. A vault
 * started against an empty database mints LMK version 1 and reports
 * `status: ok` with a root-key KCV that MATCHES the bundle — the bootstrap key
 * really did come from it. If the bundle's own active version happens to be 1,
 * every field checked below is correct and the mint passes. Production is on
 * version 4 today, so this gate would catch it there; that is luck, not design.
 * `assertRestoredDatabaseIsRecoverable` is what actually closes it, which is
 * why the pre-boot gate is never "the one the post gate makes redundant".
 *
 * @throws with both values named whenever a comparison fails.
 */
export function assertBootedOnRestoredKeys(input: BootedOnRestoredKeysInput): void {
  const { health, versionsAfterBoot, expectedBskKcv, expectedActiveVersion } = input;

  // A null resolution state omits the block and still answers 200 with
  // status 'ok'. Reading `health.rootKey?.kcv` into a comparison would compare
  // `undefined` and quietly skip the only check that matters.
  const rootKey = health.rootKey;
  if (rootKey === undefined || typeof rootKey.kcv !== 'string' || rootKey.kcv === '') {
    throw new Error(
      'The health body carries no rootKey block, so there is nothing to compare ' +
      'against the escrow bundle. This is what a null root-key resolution state ' +
      'looks like from outside — HTTP 200, status "ok", and no answer to the only ' +
      'question the drill asked.',
    );
  }

  if (rootKey.degraded === true) {
    throw new Error(
      `The node resolved a root key (${rootKey.kcv}) but reports DEGRADED: at least ` +
      'one configured provider failed. On a drill whose whole point is "the ' +
      'escrowed key opens this database", a partial answer is not an answer.',
    );
  }

  if (rootKey.kcv !== expectedBskKcv) {
    throw new Error(
      'The node booted on a DIFFERENT bootstrap key than the escrow bundle ' +
      `carries. Bundle: ${expectedBskKcv}. Running node: ${rootKey.kcv}. ` +
      'Either the key file was not restored from this bundle, or another ' +
      'root-key provider answered first.',
    );
  }

  const actives = positives(versionsAfterBoot).filter((v) => v.status === 'ACTIVE');
  const active = actives.at(0);

  if (actives.length !== 1 || active === undefined) {
    throw new Error(
      `After boot the database has ${String(actives.length)} ACTIVE LMK version(s) ` +
      `above zero (${describe(versionsAfterBoot)}); exactly one is required.`,
    );
  }

  if (active.version !== expectedActiveVersion) {
    throw new Error(
      `After boot the vault is ACTIVE on LMK version ${String(active.version)}, not ` +
      `the version ${String(expectedActiveVersion)} the escrow bundle was taken at. ` +
      'The most likely cause is that the vault MINTED a new LMK because it found ' +
      'nothing to load — which produces a healthy-looking node running on a key ' +
      'that was created seconds ago and exists nowhere else. ' +
      `Versions now: ${describe(versionsAfterBoot)}.`,
    );
  }
}

/**
 * Refuse to run the drill against anything that is not on this machine.
 *
 * The drill reads a database and then asserts things about a vault; both
 * halves are harmless. What is not harmless is running it with a production
 * URL by accident — the pre-boot gate would report a green production, the
 * post-boot gate would compare production's KCV against an escrow bundle, and
 * the whole exercise would be recorded as a successful restore drill without a
 * single byte having been restored. That is the same false green the gates
 * exist to remove, arriving through the front door.
 *
 * Hostname only. Anything that resolves elsewhere at runtime (a name pointing
 * at a remote address, an SSH tunnel) is out of scope for a lab guard, and
 * pretending otherwise would be worse than saying so.
 *
 * @throws when the target host is not loopback.
 */
export function assertIsolatedTarget(rawUrl: string, what: string): void {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(`The ${what} is not a valid URL: ${rawUrl}`);
  }

  // `new URL().hostname` KEEPS the brackets on an IPv6 literal — `[::1]`, not
  // `::1`. Comparing against the bare form silently rejects a legitimate
  // loopback bench, which is the kind of guard people disable rather than fix.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const loopback = bare === 'localhost' || bare === '::1' || bare.startsWith('127.');
  if (!loopback) {
    throw new Error(
      `Refusing to run the restore drill against ${what} host "${host}". The drill ` +
      'is only meaningful on an isolated bench: pointed at a live deployment it ' +
      'would compare that deployment against the escrow bundle and record a ' +
      'successful "restore" in which nothing was restored. Use a loopback ' +
      'address on the bench host.',
    );
  }
}
