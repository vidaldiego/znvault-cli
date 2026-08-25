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
  assertCeremonyIsOurs,
  assertCopyLabel,
  assertKeyMatchesEnvelope,
  assertKeyMatchesExpectedKcv,
  assertNoOtherCeremonyRunning,
  assertNotTheOtherCopy,
  assertRouteComplete,
  assertTransitionAllowed,
  CEREMONY_ROUTE,
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

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------
//
// These gates were added after an independent audit found the command had
// gates but no route: every subcommand jumped to a fixed phase from ANY phase,
// and `finish` asked only "are we at teardown?". The tests below are written
// against the sequences that audit actually walked.

describe('assertTransitionAllowed', () => {
  it('ALLOWS teardown from anywhere, because an abandoned ceremony must clean up', () => {
    // The first version of the table allowed teardown only after `verify`, and
    // deadlocked the case it most needed to serve: a ceremony abandoned at
    // `material` has a RAM volume holding the bootstrap key, and no command
    // could destroy it. Destroying the workspace is always safe.
    for (const from of CEREMONY_ROUTE) {
      if (from === 'teardown') continue;
      expect(() => assertTransitionAllowed(from, 'teardown')).not.toThrow();
    }
  });

  it('does NOT let an early teardown become a completed ceremony', () => {
    // Which is where the audit's start -> teardown -> finish path actually
    // dies: not at the transition, but at what `finish` demands of the record.
    expect(() => assertRouteComplete(['preflight', 'teardown'])).toThrow(/'workspace'/);
  });

  it('REFUSES skipping copy B, the likelier mistake', () => {
    expect(() => assertTransitionAllowed('write-a', 'verify')).toThrow(/'write-b'/);
  });

  it('REFUSES writing before the material has been checked', () => {
    expect(() => assertTransitionAllowed('workspace', 'write-a')).toThrow(/'material'/);
  });

  it('names what actually comes next, because the operator is mid-ceremony', () => {
    expect(() => assertTransitionAllowed('preflight', 'material')).toThrow(/'workspace'/);
  });

  it('allows the whole route, one step at a time', () => {
    for (let i = 0; i < CEREMONY_ROUTE.length - 1; i += 1) {
      const from = CEREMONY_ROUTE[i] ?? 'preflight';
      const to = CEREMONY_ROUTE[i + 1] ?? 'preflight';
      expect(() => assertTransitionAllowed(from, to)).not.toThrow();
    }
  });

  it('lets material repeat, because a ceremony checks several keys', () => {
    // Current BSK, legacy BSK, mini-CA: three separate checks, one phase.
    expect(() => assertTransitionAllowed('material', 'material')).not.toThrow();
  });

  it('REFUSES writing copy A twice', () => {
    expect(() => assertTransitionAllowed('write-a', 'write-a')).toThrow();
  });

  it('refuses to move an operation sitting at a phase it does not recognise', () => {
    expect(() => assertTransitionAllowed('rewrap', 'workspace')).toThrow(/unrecognised phase/i);
  });

  it('has nothing after teardown: the ceremony can only be closed', () => {
    expect(() => assertTransitionAllowed('teardown', 'verify')).toThrow(/last phase/i);
  });
});

describe('assertRouteComplete — what finish demands', () => {
  it('accepts a ceremony that travelled the whole route', () => {
    expect(() => assertRouteComplete([...CEREMONY_ROUTE])).not.toThrow();
  });

  it('REFUSES the ceremony that started and tore down', () => {
    expect(() => assertRouteComplete(['preflight', 'teardown'])).toThrow(/'workspace'/);
  });

  it('REFUSES when copy B was never written, and says so by name', () => {
    const missingB = CEREMONY_ROUTE.filter((p) => p !== 'write-b');
    expect(() => assertRouteComplete([...missingB])).toThrow(/'write-b'/);
  });

  it('REFUSES when nothing was verified', () => {
    const missingVerify = CEREMONY_ROUTE.filter((p) => p !== 'verify');
    expect(() => assertRouteComplete([...missingVerify])).toThrow(/'verify'/);
  });

  it('points at abort rather than leaving the operator stuck', () => {
    // A refusal with no way forward gets worked around, and the workaround is
    // what ends up in the record.
    expect(() => assertRouteComplete(['preflight'])).toThrow(/ceremony abort/);
  });

  it('tolerates repeats and ordering, since the phases are the claim', () => {
    expect(() =>
      assertRouteComplete(['preflight', 'workspace', 'material', 'material',
        'write-a', 'write-b', 'verify', 'teardown']),
    ).not.toThrow();
  });
});

describe('assertCopyLabel', () => {
  it('accepts both copies, in either case', () => {
    expect(assertCopyLabel('a')).toBe('A');
    expect(assertCopyLabel('B')).toBe('B');
  });

  it('REFUSES a label that is neither, instead of quietly meaning A', () => {
    // It used to be `label.toUpperCase() === 'B' ? write-b : write-a`, so a
    // typo did not stop anything — it recorded the wrong phase.
    expect(() => assertCopyLabel('C')).toThrow(/exactly two/i);
  });
});

describe('assertNotTheOtherCopy — what replaced the tautological gate', () => {
  // The gate this replaces compared a device's serial against a serial the
  // operator had just typed, after looking the device up BY that serial. It
  // could only ever pass. This one compares against what the ceremony already
  // RECORDED for the other copy — a value not in the operator's hands at the
  // moment of the check.

  it('REFUSES writing copy B to the device already recorded as copy A', () => {
    expect(() => assertNotTheOtherCopy('SERIAL-ONE', 'B', 'SERIAL-ONE')).toThrow(
      /same physical device as copy A/i,
    );
  });

  it('says why it matters: one stick with both, another with none', () => {
    expect(() => assertNotTheOtherCopy('SERIAL-ONE', 'B', 'SERIAL-ONE')).toThrow(
      /two places/i,
    );
  });

  it('allows a genuinely different device', () => {
    expect(() => assertNotTheOtherCopy('SERIAL-TWO', 'B', 'SERIAL-ONE')).not.toThrow();
  });

  it('allows the first copy, when nothing has been recorded yet', () => {
    expect(() => assertNotTheOtherCopy('SERIAL-ONE', 'A', null)).not.toThrow();
  });
});

describe('assertCeremonyIsOurs', () => {
  const active = { ownerNodeId: 'mac-of-the-operator', ownerPrincipal: 'someone@example.com' };

  it('REFUSES a ceremony that belongs to another machine', () => {
    // The state is in the cluster database and reachable from anywhere; the
    // facts are local. Tearing down another Mac's ceremony from here observes,
    // truthfully, that the device is absent HERE — and passes, while the real
    // RAM volume stays mounted THERE with the bootstrap key in it.
    expect(() => assertCeremonyIsOurs(active, 'some-other-mac')).toThrow(
      /mac-of-the-operator/,
    );
  });

  it('says who has it and where, so it can be chased', () => {
    expect(() => assertCeremonyIsOurs(active, 'some-other-mac')).toThrow(
      /someone@example\.com/,
    );
  });

  it('allows the machine that started it', () => {
    expect(() => assertCeremonyIsOurs(active, 'mac-of-the-operator')).not.toThrow();
  });
});
