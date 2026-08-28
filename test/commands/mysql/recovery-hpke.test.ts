import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {Chacha20Poly1305} from '@hpke/chacha20poly1305';
import {CipherSuite, HkdfSha256} from '@hpke/core';
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519';
import {
  canonicalJsonBytes,
  generateEphemeralRecoveryRecipient,
  openRecoveryCredential,
} from '../../../src/commands/mysql/recovery-hpke.js';
import type {
  MintOperation,
  RecoveryHpkeCredential,
} from '../../../src/commands/dynamic-secrets/recovery-types.js';

const INFO = Buffer.from('znvault.dynsec.recovery-credential.hpke-v1', 'utf8');
const EXPIRES_AT = '2026-08-28T12:15:00.000Z';

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });
}

function operation(): MintOperation {
  return {
    operationId: 'dmo_0123456789abcdef',
    tenantId: 'tenant-1',
    permitId: 'dmp_0123456789abcdef',
    requestId: 'recovery-request-1',
    state: 'CONSUMED',
    fenceId: 'drf_0123456789abcdef',
    fenceEpoch: 7,
    roleId: 'role-readwrite', // gitleaks:allow reason=synthetic recovery role fixture
    roleRevision: 42,
    roleConfigSha256: '1'.repeat(64),
    grantPlanSha256: '2'.repeat(64),
    effectiveGrantPlanSha256: '3'.repeat(64),
    privilegeOverlay: 'MYSQL_SCHEMA_LOCK_TABLES',
    consumerApiKeyId: 'api-key-packleader',
    leaseId: 'lease-recovery-1',
    username: 'znr_user',
    credentialExpiresAt: EXPIRES_AT,
    createdAt: '2026-08-28T12:00:00.000Z',
    claimedAt: '2026-08-28T12:00:01.000Z',
    consumedAt: '2026-08-28T12:00:02.000Z',
    deliveredAt: null,
    terminalAt: null,
    lastErrorCode: null,
  };
}

async function sealedFixture(): Promise<{
  recipient: Awaited<ReturnType<typeof generateEphemeralRecoveryRecipient>>;
  operation: MintOperation;
  delivery: RecoveryHpkeCredential;
}> {
  const recipient = await generateEphemeralRecoveryRecipient();
  const op = operation();
  const aad = canonicalJsonBytes({
    schema: 'znvault.dynsec.recovery-credential-aad.v1',
    version: 1,
    deliveryFormat: 'hpke-v1',
    suite: 'X25519-HKDF-SHA256-ChaCha20Poly1305',
    tenantId: 'tenant-1',
    roleId: op.roleId,
    fenceId: op.fenceId,
    fenceEpoch: op.fenceEpoch,
    permitId: op.permitId,
    requestId: op.requestId,
    leaseId: op.leaseId,
    consumerApiKeyId: 'api-key-packleader',
    roleRevision: op.roleRevision,
    roleConfigSha256: op.roleConfigSha256,
    grantPlanSha256: op.grantPlanSha256,
    recipientKeyId: recipient.recipientKeyId,
    credentialExpiresAt: op.credentialExpiresAt,
    privilegeOverlay: op.privilegeOverlay,
  });
  const plaintext = canonicalJsonBytes({
    schema: 'znvault.dynsec.recovery-credential.v1',
    version: 1,
    username: 'znr_user',
    password: 'memory-only-password',
    host: 'mysql.example.internal',
    port: 3306,
    database: 'packleader',
    expiresAt: EXPIRES_AT,
  });
  const hpke = suite();
  const publicKey = await hpke.kem.deserializePublicKey(
    Buffer.from(recipient.recipientPublicKey, 'base64url'),
  );
  const sealed = await hpke.seal({recipientPublicKey: publicKey, info: INFO}, plaintext, aad);
  const envelope = {
    version: 'hpke-v1' as const,
    suite: 'X25519-HKDF-SHA256-ChaCha20Poly1305' as const,
    enc: Buffer.from(sealed.enc).toString('base64url'),
    ciphertext: Buffer.from(sealed.ct).toString('base64url'),
    aadSha256: `sha256:${createHash('sha256').update(aad).digest('hex')}`,
  };
  const delivery: RecoveryHpkeCredential = {
    permitId: op.permitId,
    requestId: op.requestId,
    state: 'CONSUMED',
    envelopeSha256: `sha256:${createHash('sha256').update(canonicalJsonBytes(envelope)).digest('hex')}`,
    deliveryFormat: 'hpke-v1',
    envelope,
    aad: aad.toString('base64url'),
  };
  plaintext.fill(0);
  aad.fill(0);
  return {recipient, operation: op, delivery};
}

describe('Recovery Fence v1 consumer HPKE', () => {
  it('generates a raw X25519 recipient and authenticates/decrypts the exact contract', async () => {
    const fixture = await sealedFixture();
    expect(Buffer.from(fixture.recipient.recipientPublicKey, 'base64url')).toHaveLength(32);
    expect(fixture.recipient.recipientKeyId).toMatch(/^sha256:[0-9a-f]{64}$/);

    const credential = await openRecoveryCredential(fixture);
    expect(credential).toEqual({
      schema: 'znvault.dynsec.recovery-credential.v1',
      version: 1,
      username: 'znr_user',
      password: 'memory-only-password',
      host: 'mysql.example.internal',
      port: 3306,
      database: 'packleader',
      expiresAt: EXPIRES_AT,
    });
  });

  it('rejects a stale fence epoch before returning plaintext', async () => {
    const fixture = await sealedFixture();
    fixture.operation.fenceEpoch++;
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/epoch|revision/i);
  });

  it('rejects an authenticated AAD bound to a different tenant', async () => {
    const fixture = await sealedFixture();
    fixture.operation.tenantId = 'tenant-2';
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/tenant binding/i);
  });

  it('rejects an authenticated AAD bound to a different consumer API key', async () => {
    const fixture = await sealedFixture();
    fixture.operation.consumerApiKeyId = 'api-key-other';
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/consumer API key binding/i);
  });

  it('rejects a byte change in the persisted envelope digest', async () => {
    const fixture = await sealedFixture();
    fixture.delivery.envelopeSha256 = `sha256:${'0'.repeat(64)}`;
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/envelope digest/i);
  });

  it('rejects AAD that is not authenticated by the envelope', async () => {
    const fixture = await sealedFixture();
    const raw = Buffer.from(fixture.delivery.aad, 'base64url');
    raw[raw.length - 1] ^= 1;
    fixture.delivery.aad = raw.toString('base64url');
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/AAD|JSON/i);
  });

  it('rejects option-file newline injection from an authenticated plaintext', async () => {
    const fixture = await sealedFixture();
    // A new ciphertext is needed so the bad plaintext is still authentically
    // delivered. Rebuild from the same AAD/public key.
    const aad = Buffer.from(fixture.delivery.aad, 'base64url');
    const plaintext = canonicalJsonBytes({
      schema: 'znvault.dynsec.recovery-credential.v1',
      version: 1,
      username: 'safe\npassword=injected',
      password: 'pw',
      host: 'mysql.example.internal',
      port: 3306,
      database: 'packleader',
      expiresAt: EXPIRES_AT,
    });
    const hpke = suite();
    const publicKey = await hpke.kem.deserializePublicKey(
      Buffer.from(fixture.recipient.recipientPublicKey, 'base64url'),
    );
    const sealed = await hpke.seal({recipientPublicKey: publicKey, info: INFO}, plaintext, aad);
    fixture.delivery.envelope.enc = Buffer.from(sealed.enc).toString('base64url');
    fixture.delivery.envelope.ciphertext = Buffer.from(sealed.ct).toString('base64url');
    fixture.delivery.envelopeSha256 = `sha256:${createHash('sha256')
      .update(canonicalJsonBytes(fixture.delivery.envelope)).digest('hex')}`;
    await expect(openRecoveryCredential(fixture)).rejects.toThrow(/username/i);
    plaintext.fill(0);
    aad.fill(0);
  });
});
