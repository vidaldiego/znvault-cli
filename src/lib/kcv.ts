// Path: src/lib/kcv.ts
//
// Key Check Value (KCV) for the vault's bootstrap key (BSK).
//
// PORT NOTICE. This is the CLI-side copy of
// zn-vault/src/vault-crypto/root-key/kcv.ts. The construction, the label, the
// truncation and the pattern are identical, and they must stay identical:
// this package compares its output against `root_key_envelopes.kcv` and
// against the `rootKey.kcv` that every node publishes on /v1/health.
//
// The copy exists because znvault-cli ships to npm on its own and has no path
// to the server's `src/`. Two copies of a contract are normally how a contract
// dies quietly — both suites green, the two sides agreeing on nothing. The
// defence is that NEITHER side is checked against the other: both are checked
// against the same frozen golden vectors (test/lib/kcv.test.ts here,
// src/vault-crypto/root-key/kcv.test.ts there). Change the label or the
// truncation on either side and both suites go red.
//
// If you are here to "fix" a golden-vector failure: don't. It means the
// fingerprint of every envelope already recorded in production just changed
// meaning.
//
// ---------------------------------------------------------------------------
//
// The KCV answers "is this the correct BSK?" WITHOUT exposing the key:
//
//   KCV = "kcv1:" + hex( HMAC-SHA256(key = BSK, msg = "zn-vault-bsk-kcv-v1")[0..16) )
//
// HMAC-SHA256 is a PRF, so with the key unknown the output reveals nothing
// about it; publishing a KCV hands an attacker only an offline equality check
// at one HMAC per candidate, which is no speedup against a uniformly random
// 256-bit key. The dedicated, versioned label keeps the BSK out of the
// production AES-GCM cipher entirely and pins the value's purpose so it cannot
// collide with any other derivation. Truncation to 128 bits is for equality
// comparison, not collision resistance against an adversary who picks the
// keys; NIST SP 800-107 sanctions truncated HMAC at >= 112 bits.

import { createHmac } from 'node:crypto';

/** Domain-separation label. Versioned; changing it is a new KCV format. */
export const BSK_KCV_CONTEXT = 'zn-vault-bsk-kcv-v1';

const BSK_LEN = 32;
const KCV_TRUNC_BYTES = 16;

/**
 * Compute the publishable Key Check Value of a bootstrap key.
 *
 * Deterministic: same key, same KCV — across providers, nodes and sites.
 * Safe to log and display; never reveals or accelerates recovery of the key.
 *
 * @throws if the key is not exactly 32 bytes. A short buffer would still
 *   produce a well-formed fingerprint — of the wrong thing — and the escrow
 *   gate would report it as "the two custodies hold different keys".
 */
export function computeBskKcv(key: Buffer): string {
  if (key.length !== BSK_LEN) {
    throw new Error(
      `KCV requires a ${String(BSK_LEN)}-byte key, got ${String(key.length)} bytes`,
    );
  }
  const mac = createHmac('sha256', key).update(BSK_KCV_CONTEXT, 'utf-8').digest();
  return `kcv1:${mac.subarray(0, KCV_TRUNC_BYTES).toString('hex')}`;
}

/**
 * Exactly what {@link computeBskKcv} emits: the literal `kcv1:` prefix and the
 * 128-bit truncated MAC as 32 LOWERCASE hex characters. Anchored at both ends,
 * so nothing can be appended or prepended.
 */
const BSK_KCV_PATTERN = /^kcv1:[0-9a-f]{32}$/;

/**
 * Is this string a KCV of the construction above?
 *
 * On this side of the port the values being gated arrive from PostgreSQL
 * (`root_key_envelopes.kcv`, a TEXT column with no CHECK constraint) and from
 * an unauthenticated `/v1/health` body. They are not merely compared: they are
 * republished into signed preflight evidence that leaves the CPD. A
 * "looks-plausible" check would let arbitrary text — including something
 * shaped like key material — into that artefact.
 *
 * Pinning the ACTUAL construction closes it for free: anything a KCV
 * comparison could ever legitimately succeed against matches this pattern, so
 * refusing everything else costs nothing. A malformed value is a protocol
 * violation, distinct from — and checked before — a well-formed KCV that
 * disagrees.
 *
 * Non-strings return false rather than throwing: the caller is reading a
 * nullable column.
 */
export function isBskKcv(value: string): boolean {
  if (typeof value !== 'string') return false;
  return BSK_KCV_PATTERN.test(value);
}
