// Path: test/lib/restore-drill.test.ts
//
// The isolated-restore drill can exit 0 without having restored anything.
//
// That is not a hypothesis. If the restored database ends up with zero LMK
// versions above zero, `initializeFromPG()` reads "no ACTIVE version" and calls
// `bootstrapInitialLMKVersion()`, which is the legitimate first-boot path: it
// MINTS A NEW LMK, wraps it under the bootstrap key on disk, inserts version 1,
// and the vault comes up perfectly healthy. `/v1/health` returns 200,
// `status: 'ok'`, and a root key whose KCV even matches the escrow bundle —
// because the BSK was genuinely restored from it.
//
// Everything an operator would look at says the drill succeeded. What actually
// happened is that a brand-new key hierarchy was created over an empty
// database, and the property the drill exists to demonstrate — that the escrow
// bundle can bring back THIS deployment's keys — was never tested at all.
//
// So the drill's verdict cannot come from an exit code or an HTTP status.
// Degraded root-key resolution also returns 200 (`/v1/health` reports degraded
// inside the body), and a missing `rootKey` block returns 200 as well. Both
// gates below therefore read state, compare it against the bundle, and say why.
//
// These are pure functions on purpose: the orchestration around them is a shell
// script driving docker, which cannot be unit-tested, so everything that
// decides anything lives here instead.

import { describe, expect, it } from 'vitest';
import {
  assertRestoredDatabaseIsRecoverable,
  assertBootedOnRestoredKeys,
  assertIsolatedTarget,
  type RestoredLmkVersion,
} from '../../src/lib/restore-drill.js';

const KCV = 'kcv1:0aefffaf36e10342c827e949f8276fd8';
const OTHER_KCV = 'kcv1:c25a0581ab054cc16e32a168a9ad22bb';

/** Production's shape: placeholder, a historical gap, two retired, one active. */
function restoredVersions(overrides: RestoredLmkVersion[] = []): RestoredLmkVersion[] {
  return overrides.length > 0
    ? overrides
    : [
        { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
        { version: 1, status: 'RETIRED', hasWrappedLmk: false },
        { version: 3, status: 'RETIRED', hasWrappedLmk: true },
        { version: 4, status: 'ACTIVE', hasWrappedLmk: true },
      ];
}

describe('assertRestoredDatabaseIsRecoverable (before the vault is started)', () => {
  it('accepts a database that carries recoverable key material', () => {
    expect(() =>
      assertRestoredDatabaseIsRecoverable(restoredVersions(), 4),
    ).not.toThrow();
  });

  it('REFUSES an empty version table — the false green this gate exists for', () => {
    // With nothing above version 0, starting the vault would mint a new LMK and
    // report a healthy boot. The drill has to stop BEFORE that, because once
    // the key is minted the evidence of what went wrong is gone.
    expect(() =>
      assertRestoredDatabaseIsRecoverable(
        [{ version: 0, status: 'ACTIVE', hasWrappedLmk: false }],
        4,
      ),
    ).toThrow(/mint/i);
  });

  it('REFUSES a table with only the placeholder and no positive version at all', () => {
    expect(() => assertRestoredDatabaseIsRecoverable([], 4)).toThrow(/mint/i);
  });

  it('REFUSES when every positive version lost its wrapped material', () => {
    // Rows present, key material gone: a restore that brought back the
    // inventory and not the keys. Booting reaches the same mint path.
    expect(() =>
      assertRestoredDatabaseIsRecoverable(
        [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
          { version: 4, status: 'ACTIVE', hasWrappedLmk: false },
        ],
        4,
      ),
    ).toThrow(/wrapped|material/i);
  });

  it('REFUSES when the version the bundle says is ACTIVE is not the one restored', () => {
    // The bundle is a snapshot of a moment. If the database restored alongside
    // it is from a different moment, the drill proves nothing about either.
    expect(() => assertRestoredDatabaseIsRecoverable(restoredVersions(), 3)).toThrow(
      /expected.*3|active/i,
    );
  });

  it('REFUSES two ACTIVE positive versions', () => {
    expect(() =>
      assertRestoredDatabaseIsRecoverable(
        [
          { version: 3, status: 'ACTIVE', hasWrappedLmk: true },
          { version: 4, status: 'ACTIVE', hasWrappedLmk: true },
        ],
        4,
      ),
    ).toThrow(/ACTIVE/);
  });

  it('ignores the version-0 placeholder when counting', () => {
    // Present in every real database and ACTIVE by design.
    expect(() =>
      assertRestoredDatabaseIsRecoverable(
        [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
          { version: 4, status: 'ACTIVE', hasWrappedLmk: true },
        ],
        4,
      ),
    ).not.toThrow();
  });
});

describe('assertBootedOnRestoredKeys (after the vault is up)', () => {
  const healthy = {
    status: 'ok',
    rootKey: { provider: 'local-file', kcv: KCV, degraded: false },
  };

  it('accepts a vault that came up on the escrowed key and the escrowed version', () => {
    expect(() =>
      assertBootedOnRestoredKeys({
        health: healthy,
        versionsAfterBoot: restoredVersions(),
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).not.toThrow();
  });

  it('REFUSES a health body with no rootKey block', () => {
    // `getRootKeyResolutionState()` returning null omits the whole block, and
    // the response is still 200 with status 'ok'. Reading `health.rootKey?.kcv`
    // against an expected value would compare undefined and pass a check that
    // never ran.
    expect(() =>
      assertBootedOnRestoredKeys({
        health: { status: 'ok' },
        versionsAfterBoot: restoredVersions(),
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).toThrow(/rootKey/);
  });

  it('REFUSES a KCV that does not match the bundle', () => {
    expect(() =>
      assertBootedOnRestoredKeys({
        health: { status: 'ok', rootKey: { provider: 'local-file', kcv: OTHER_KCV } },
        versionsAfterBoot: restoredVersions(),
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).toThrow(/kcv/i);
  });

  it('REFUSES a degraded resolution even though the status is ok and the code was 200', () => {
    // Degraded means at least one provider failed. On a drill whose entire
    // point is "the escrowed key opens this database", a partial answer is not
    // an answer.
    expect(() =>
      assertBootedOnRestoredKeys({
        health: { status: 'ok', rootKey: { provider: 'local-file', kcv: KCV, degraded: true } },
        versionsAfterBoot: restoredVersions(),
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).toThrow(/degraded/i);
  });

  it('REFUSES when a NEW version appeared during boot — the mint, caught after the fact', () => {
    // The belt to the pre-boot gate's braces. If the pre-boot check were ever
    // weakened or skipped, this still catches it: the bundle says the ACTIVE
    // version is 4, and the vault is running on a version 1 it just created.
    expect(() =>
      assertBootedOnRestoredKeys({
        health: healthy,
        versionsAfterBoot: [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
          { version: 1, status: 'ACTIVE', hasWrappedLmk: true },
        ],
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).toThrow(/minted|new LMK|expected/i);
  });

  it('REFUSES when the boot changed which version is ACTIVE', () => {
    expect(() =>
      assertBootedOnRestoredKeys({
        health: healthy,
        versionsAfterBoot: [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
          { version: 3, status: 'ACTIVE', hasWrappedLmk: true },
          { version: 4, status: 'DEPRECATED', hasWrappedLmk: true },
        ],
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      }),
    ).toThrow();
  });

  it('CANNOT catch a mint whose version collides with the expected one', () => {
    // The limit of this gate, pinned rather than left to be discovered.
    //
    // Verified on a real bench 2026-08-23: a vault started against a
    // schema-only-restored database minted LMK version 1 and answered
    // `status: ok` with a root-key KCV that MATCHED the escrow bundle — because
    // the bootstrap key genuinely came from it. Every field this gate reads was
    // correct. The deployment that produced that bundle was itself young, so
    // the bundle's activeLmkVersion was also 1, and the collision made the mint
    // indistinguishable from a real restore.
    //
    // Production is currently on version 4, so there the post gate WOULD catch
    // it. That is luck, not design. The pre-boot gate is what actually closes
    // this, which is why it is not redundant and must never be skipped as "the
    // post gate will catch it anyway".
    expect(() =>
      assertBootedOnRestoredKeys({
        health: healthy,
        versionsAfterBoot: [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false },
          { version: 1, status: 'ACTIVE', hasWrappedLmk: true },
        ],
        expectedBskKcv: KCV,
        expectedActiveVersion: 1,
      }),
    ).not.toThrow();
  });

  it('says what to compare, because a failed drill is investigated cold', () => {
    let message = '';
    try {
      assertBootedOnRestoredKeys({
        health: { status: 'ok', rootKey: { provider: 'local-file', kcv: OTHER_KCV } },
        versionsAfterBoot: restoredVersions(),
        expectedBskKcv: KCV,
        expectedActiveVersion: 4,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    // Both fingerprints, so the reader does not have to go and find them.
    expect(message).toContain(KCV);
    expect(message).toContain(OTHER_KCV);
  });
});

describe('assertIsolatedTarget', () => {
  it('accepts loopback in its usual spellings', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/db',
      'postgres://u:p@127.0.0.1:5432/db',
      'postgres://u:p@127.1.2.3:5432/db',
      'https://localhost:8443/v1/health',
      'https://[::1]:8443/v1/health',
    ]) {
      expect(() => assertIsolatedTarget(url, 'database')).not.toThrow();
    }
  });

  it('REFUSES anything else, which is how the drill meets production by accident', () => {
    // Pointed at a live deployment the gates would compare THAT deployment
    // against the escrow bundle and record a successful restore in which
    // nothing was restored — the same false green, through the front door.
    for (const url of [
      'postgres://u:p@192.0.2.10:6432/znvault',
      'https://vault.example.com/v1/health',
      'postgres://u:p@db.internal:5432/znvault',
    ]) {
      expect(() => assertIsolatedTarget(url, 'database')).toThrow(/isolated bench/i);
    }
  });

  it('names which target was wrong', () => {
    expect(() => assertIsolatedTarget('https://vault.example.com/v1/health', 'health endpoint'))
      .toThrow(/health endpoint/);
  });

  it('rejects something that is not a URL at all rather than guessing', () => {
    expect(() => assertIsolatedTarget('not a url', 'database')).toThrow(/valid URL/i);
  });
});
