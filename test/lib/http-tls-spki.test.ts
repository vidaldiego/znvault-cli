import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';

import { verifyPinnedServerSpki } from '../../src/lib/client/http.js';

function fixture(): { raw: Buffer; pin: string } {
  const certificate = new X509Certificate(rootCertificates[0]);
  const raw = certificate.raw;
  const spki = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const pin = createHash('sha256').update(spki).digest('hex');
  return { raw, pin };
}

describe('TLS SPKI pinning', () => {
  it('accepts the reviewed public key and rejects drift', () => {
    const { raw, pin } = fixture();

    expect(verifyPinnedServerSpki(raw, pin)).toBeUndefined();
    expect(verifyPinnedServerSpki(raw, '0'.repeat(64))?.message).toContain('does not match');
  });

  it('fails closed on malformed pins and missing peer certificates', () => {
    const { raw, pin } = fixture();

    expect(verifyPinnedServerSpki(raw, 'not-a-pin')?.message).toContain('Invalid');
    expect(verifyPinnedServerSpki(undefined, pin)?.message).toContain('unavailable');
  });
});
