import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dirs: string[] = [];
const fingerprint = '11'.repeat(16);
const manifest = Buffer.from(JSON.stringify({ manifestVersion: 2, backupId: 42, serviceName: 'synthetic', storageKey: 'dumps/synthetic.arcn', wrappedDek: '22'.repeat(60), wrappingKeyFingerprint: fingerprint, compression: 'none', artifactSize: null, artifactEtag: null, dumpChecksum: null }));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const selection = () => ({ format: 'znvault-backup-selection-v1', sourceNamespace: 'custodied-synthetic', installationUuid: null, serviceName: 'synthetic', backupId: 42, metadata: { kind: 'manifest', sha256: digest(manifest), bytes: manifest.length }, keyBindings: [{ fingerprint, key: { kind: 'archon-kek-fingerprint-v1', fingerprint, algorithm: 'aes-256-gcm' } }] });
async function file(bytes: string | Buffer): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'recovery-selection-')); dirs.push(dir); const path = join(dir, 'selected.json'); await writeFile(path, bytes); return path; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('explicit custodied selection snapshot', () => {
  // Catches deriving authority from backup metadata or choosing another backup.
  it('uses only explicit custodied expectation and rejects changed digest and identity', async () => {
    const { loadTrustedSelection } = await import('../../src/commands/recovery/local.js');
    const { verifyRecoverySet } = await import('../../src/vendor/archon-recovery-core/index.js');
    const expected = await loadTrustedSelection(await file(JSON.stringify(selection())));
    expect(verifyRecoverySet(expected, manifest).components[0].key.kind).toBe('archon-kek-fingerprint-v1');
    expect(() => verifyRecoverySet(expected, Buffer.from(manifest.toString().replace('42', '43')))).toThrow();
    expect(() => verifyRecoverySet({ ...expected, backupId: 43 }, manifest)).toThrow();
    await expect(loadTrustedSelection('')).rejects.toThrow();
    await expect(loadTrustedSelection(await file(manifest))).rejects.toThrow();
  });
  it('rejects duplicate decoded fields, duplicate fingerprints and absent authority namespace', async () => {
    const { loadTrustedSelection } = await import('../../src/commands/recovery/local.js');
    const value = selection();
    for (const bytes of [JSON.stringify(value).replace('"backupId":42', '"backupId":42,"backupId":42'), JSON.stringify({ ...value, keyBindings: [value.keyBindings[0], value.keyBindings[0]] }), JSON.stringify({ ...value, sourceNamespace: '' })]) {
      await expect(loadTrustedSelection(await file(bytes))).rejects.toThrow();
    }
  });
  it('accepts exact historical reference authority without an added HMAC', async () => {
    const { loadTrustedSelection } = await import('../../src/commands/recovery/local.js');
    const { verifyRecoverySet } = await import('../../src/vendor/archon-recovery-core/index.js');
    const reference = Buffer.from(JSON.stringify({ format: 'archon-dr-references-v1', backupId: 42, serviceId: 7, references: [{ destinationId: 1, serviceName: 'synthetic', bucket: 'synthetic-bucket', endpoint: null, region: null, key: 'manifests/synthetic/backup-42.json', versionId: 'version-1', sha256: digest(manifest) }] }));
    const expected = await loadTrustedSelection(await file(JSON.stringify({ ...selection(), metadata: { kind: 'reference', sha256: digest(reference), bytes: reference.length } })));
    expect(verifyRecoverySet(expected, manifest, reference).components).toHaveLength(1);
  });
  it('owns a bounded snapshot and refuses linked, oversized and nonregular files', async () => {
    const { loadTrustedSelection, readMetadataSnapshot } = await import('../../src/commands/recovery/local.js');
    const path = await file(JSON.stringify(selection()));
    const expected = await loadTrustedSelection(path);
    await writeFile(path, '{}');
    expect(expected.backupId).toBe(42);
    const alias = `${path}.link`; await symlink(path, alias);
    await expect(loadTrustedSelection(alias)).rejects.toThrow();
    await link(path, `${path}.hard`); await expect(loadTrustedSelection(path)).rejects.toThrow();
    await expect(readMetadataSnapshot(await file(Buffer.alloc(1048577)), 1048576)).rejects.toThrow();
    await expect(readMetadataSnapshot(dirs[0], 1048576)).rejects.toThrow();
  });
});
