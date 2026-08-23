// Path: test/lib/kcv.test.ts
//
// The CLI needs the BSK Key Check Value for three things that are about to be
// built: the preflight evidence (it republishes `root_key_envelopes.kcv` and
// must refuse anything that is not this format), the escrow receipt (which
// today prints a RAW, untruncated SHA-256 of the bootstrap key and must stop),
// and the two-media escrow gate (which compares the fingerprints of two
// bundles and is worthless if the two sides disagree on what a fingerprint is).
//
// WHY A SEPARATE IMPLEMENTATION AT ALL. This package does not, and should not,
// import from the vault server's `src/` — it ships to npm on its own. So the
// construction necessarily exists twice.
//
// WHY THAT IS SAFE HERE, AND ONLY HERE. Two copies of a contract normally
// drift in silence, with both suites green while the two sides agree on
// nothing. The defence is that neither side is checked against the other:
// both are checked against the SAME FROZEN LITERALS below, produced by the
// server implementation on 2026-08-23 — the same implementation that computed
// every KCV currently stored in `root_key_envelopes`. The identical pairs are
// pinned in zn-vault/src/vault-crypto/root-key/kcv.test.ts.
//
// Deliberately NOT done here: recomputing the expected value from
// createHmac(...) primitives. The server's suite already does that, and it is
// exactly the test that stays green under a drift applied to both the
// implementation and the recomputation at once (verified: perturbing the label
// in both places leaves that test passing and fails only the golden vectors).
//
// Every key here is a fixed synthetic pattern. No real key material.

import { describe, expect, it } from 'vitest';
import { BSK_KCV_CONTEXT, computeBskKcv, isBskKcv } from '../../src/lib/kcv.js';

/**
 * Frozen golden vectors. Do not regenerate, do not "fix".
 *
 * A failure here is never a test to update: it means this package's idea of a
 * bootstrap-key fingerprint just diverged from the vault's, and every
 * comparison the preflight and the escrow gate make became meaningless while
 * still reporting agreement.
 */
const GOLDEN: ReadonlyArray<readonly [string, string, string]> = [
  [
    'all 0x7e',
    '7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e',
    'kcv1:0aefffaf36e10342c827e949f8276fd8',
  ],
  [
    'all zero',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'kcv1:c25a0581ab054cc16e32a168a9ad22bb',
  ],
  [
    'counting 0x00..0x1f',
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    'kcv1:927644d70806a3a295c388eee7d50cdb',
  ],
];

describe('computeBskKcv', () => {
  it.each(GOLDEN)(
    'pins the frozen golden vector for %s',
    (_name, keyHex, expected) => {
      expect(computeBskKcv(Buffer.from(keyHex, 'hex'))).toBe(expected);
    },
  );

  it('exports the same domain-separation label as the vault', () => {
    // Pinned as a literal, not read from the implementation: this string IS
    // the format version. Changing it retires every stored KCV.
    expect(BSK_KCV_CONTEXT).toBe('zn-vault-bsk-kcv-v1');
  });

  it('rejects a key that is not exactly 32 bytes', () => {
    // The BSK is 32 bytes. Accepting a short buffer would produce a
    // well-formed fingerprint of the wrong thing — which compares unequal and
    // gets diagnosed as "the two custodies hold different keys".
    expect(() => computeBskKcv(Buffer.alloc(31))).toThrow(/32-byte/);
    expect(() => computeBskKcv(Buffer.alloc(33))).toThrow(/32-byte/);
    expect(() => computeBskKcv(Buffer.alloc(0))).toThrow(/32-byte/);
  });

  it('does not mutate the key buffer it is given', () => {
    const key = Buffer.from(GOLDEN[0][1], 'hex');
    const copy = Buffer.from(key);
    computeBskKcv(key);
    expect(key.equals(copy)).toBe(true);
  });

  it('distinguishes two keys that differ in a single bit', () => {
    const a = Buffer.alloc(32, 0x00);
    const b = Buffer.alloc(32, 0x00);
    b[31] = 0x01;
    expect(computeBskKcv(a)).not.toBe(computeBskKcv(b));
  });
});

describe('isBskKcv', () => {
  it('accepts every golden vector', () => {
    for (const [, , kcv] of GOLDEN) {
      expect(isBskKcv(kcv)).toBe(true);
    }
  });

  it('is anchored at both ends, so nothing can be wrapped around a KCV', () => {
    const [, , good] = GOLDEN[0];
    // The preflight republishes whatever `root_key_envelopes.kcv` holds, and
    // that column carries no CHECK constraint. An unanchored pattern would
    // wave through a row whose value merely CONTAINS a KCV.
    expect(isBskKcv(` ${good}`)).toBe(false);
    expect(isBskKcv(`${good} `)).toBe(false);
    expect(isBskKcv(`kcv1:${good}`)).toBe(false);
    expect(isBskKcv(`${good}00`)).toBe(false);
    expect(isBskKcv(`prefix-${good}`)).toBe(false);
  });

  it('rejects a raw digest with no version prefix', () => {
    // This is the concrete thing being kept out of receipts and audit rows:
    // a bare hex digest of the bootstrap key.
    expect(isBskKcv('0aefffaf36e10342c827e949f8276fd8')).toBe(false);
    expect(
      isBskKcv(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ),
    ).toBe(false);
  });

  it('rejects a future or unknown version prefix', () => {
    expect(isBskKcv('kcv2:0aefffaf36e10342c827e949f8276fd8')).toBe(false);
    expect(isBskKcv('kcv:0aefffaf36e10342c827e949f8276fd8')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    // computeBskKcv only ever emits lowercase. Accepting uppercase would make
    // two spellings of the same fingerprint compare unequal in the escrow
    // gate, which reads as "two different keys".
    expect(isBskKcv('kcv1:0AEFFFAF36E10342C827E949F8276FD8')).toBe(false);
  });

  it('rejects the wrong hex length', () => {
    expect(isBskKcv('kcv1:0aefffaf36e10342c827e949f8276fd')).toBe(false);
    expect(isBskKcv('kcv1:0aefffaf36e10342c827e949f8276fd80')).toBe(false);
    expect(isBskKcv('kcv1:')).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    // It guards a column read out of PostgreSQL, so it will meet null.
    expect(isBskKcv(null as unknown as string)).toBe(false);
    expect(isBskKcv(undefined as unknown as string)).toBe(false);
    expect(isBskKcv(42 as unknown as string)).toBe(false);
  });
});
