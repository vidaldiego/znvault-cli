import {describe, expect, it} from 'vitest';

async function library() {
  const module = await import('../../src/lib/totp.js').catch(() => undefined);
  expect(module, 'TOTP support must be implemented').toBeDefined();
  return module!;
}

// RFC 6238 Appendix B uses these ASCII keys, independently encoded as Base32.
const sha1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const sha256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const sha512 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

describe('TOTP import and generation', () => {
  it.each([
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ])('matches all RFC 6238 algorithms at %i seconds', async (seconds, want1, want256, want512) => {
    const {generateTotpCode} = await library();
    for (const [secret, algorithm, want] of [[sha1, 'SHA1', want1], [sha256, 'SHA256', want256], [sha512, 'SHA512', want512]] as const) {
      expect(generateTotpCode({type: 'totp', secret, algorithm, digits: 8, period: 30}, Number(seconds) * 1000).code).toBe(want);
    }
  });

  it('normalizes seed input and applies six-digit defaults without dropping leading zeroes', async () => {
    const {parseTotpInput, generateTotpCode} = await library();
    const config = parseTotpInput(' gezd gnbv gy3t qojq gezd gnbv gy3t qojq\n');
    expect(config).toEqual({type: 'totp', secret: sha1, algorithm: 'SHA1', digits: 6, period: 30});
    expect(generateTotpCode(config, 1111111109000)).toEqual({code: '081804', validUntil: 1111111110000, period: 30});
    expect(generateTotpCode(config, 30000).validUntil).toBe(60000);
  });

  it('accepts valid Base32 padding and supported URI metadata', async () => {
    const {parseTotpInput} = await library();
    expect(parseTotpInput(sha256 + '====').secret).toBe(sha256);
    expect(parseTotpInput(`otpauth://totp/Acme:alice%40example.test?secret=${sha1}&issuer=Acme&algorithm=SHA256&digits=8&period=60`)).toEqual({
      type: 'totp', secret: sha1, algorithm: 'SHA256', digits: 8, period: 60, issuer: 'Acme', accountName: 'alice@example.test',
    });
  });

  it.each([
    'JBSWY3DP', // Too short.
    'A'.repeat(207), // Too long after decoding.
    sha1 + '=', // Invalid padding.
    sha256.slice(0, -1) + 'B', // Non-zero unused bits.
    `otpauth://hotp/alice?secret=${sha1}&counter=1`,
    `otpauth://totp/alice?secret=${sha1}&secret=${sha1}`,
    `otpauth://totp/alice?secret=${sha1}&algorithm=MD5`,
    `otpauth://totp/alice?secret=${sha1}&digits=7`,
    `otpauth://totp/alice?secret=${sha1}&period=0`,
    `otpauth://totp/alice?secret=${sha1}&period=301`,
    `otpauth://totp/alice?secret=${sha1}&period=1.5`,
    `otpauth://totp/Issuer:alice?secret=${sha1}&issuer=Other`,
    `otpauth://totp/alice?secret=${sha1}&counter=1`,
    `otpauth://totp/alice?secret=${sha1}#fragment`,
    `otpauth://totp/${'x'.repeat(129)}?secret=${sha1}`,
    `otpauth://totp/alice?secret=${sha1}&issuer=${'x'.repeat(129)}`,
    'X'.repeat(4097),
    'otpauth://totp/%ZZ?secret=never-echo-this-marker',
  ])('rejects invalid input without including it in the error', async (input) => {
    const {parseTotpInput} = await library();
    expect(() => parseTotpInput(input)).toThrow(/^Invalid TOTP configuration\.$/);
  });

  it('only reads a validated discriminated config, leaving legacy fields alone', async () => {
    const {readTotpConfig} = await library();
    expect(readTotpConfig({totp: {secret: sha1}})).toBeUndefined();
    expect(readTotpConfig({totp: 'legacy'})).toBeUndefined();
    expect(() => readTotpConfig({totp: {type: 'totp', secret: sha1, algorithm: 'MD5', digits: 6, period: 30}})).toThrow(/^Invalid TOTP configuration\.$/);
  });
});
