// Path: src/lib/lmk-escrow.ts

import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import {
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { LmkEscrowDatabaseSnapshot } from './db/index.js';

const MAGIC = Buffer.from('ZNVAULT-LMK-ESCROW\n', 'ascii');
const FORMAT_VERSION = 1;
const DIGEST_BYTES = 32;
const BSK_BYTES = 32;
const WRAPPED_LMK_BYTES = 61;
const MAX_BUNDLE_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_LMK_VERSIONS = 4096;

interface LmkEscrowVersionMetadata {
  version: number;
  keyId: string;
  status: string;
  createdAt: string | null;
  activatedAt: string | null;
  deprecatedAt: string | null;
  retiredAt: string | null;
  description: string | null;
  createdBy: string | null;
  rotatedFromVersion: number | null;
  deksMigratedCount: number;
  deksPendingCount: number;
  materialState: 'WRAPPED' | 'UNRECOVERABLE';
  wrappedBytes: number;
}

interface LmkEscrowMetadataV1 {
  format: 'znvault-lmk-escrow';
  formatVersion: 1;
  createdAt: string;
  copyLabel: string;
  operator: string;
  source: {
    hostname: string;
    vaultVersion: string | null;
    cliVersion: string;
    nodeVersion: string;
    databaseName: string;
    postgresVersion: string;
    capturedAt: string;
    walLsn: string;
    transactionSnapshot: string;
    latestMigration: string | null;
  };
  backup: {
    state: 'VERIFIED';
    id: string;
    filename: string;
    checksum: string;
    encrypted: true;
    completedAt: string;
    verifiedAt: string;
  } | {
    state: 'UNBOUND_LAB_ONLY';
  };
  bskSha256: string;
  activeLmkVersion: number;
  allAvailableVersionsRecoverable: boolean;
  lmkVersions: LmkEscrowVersionMetadata[];
  auditHead: {
    id: string;
    timestamp: string | null;
    currentHmacBase64: string;
    lmkVersion: number;
    hmacFormatVersion: number;
  } | null;
  activeRotation: {
    rotationId: string;
    oldLmkVersion: number;
    newLmkVersion: number;
    status: string;
    startedAt: string | null;
  } | null;
}

interface ParsedBundle {
  metadata: LmkEscrowMetadataV1;
  bsk: Buffer;
  wrappedLmks: Array<{ version: number; wrapped: Buffer | null }>;
  bundleDigest: Buffer;
}

export interface BuildLmkEscrowBundleOptions {
  snapshot: LmkEscrowDatabaseSnapshot;
  bsk: Buffer;
  copyLabel: string;
  operator: string;
  hostname: string;
  vaultVersion: string | null;
  cliVersion: string;
  allowUnboundBackup: boolean;
}

export interface LmkEscrowVerificationReport {
  valid: true;
  formatVersion: 1;
  bundleId: string;
  createdAt: string;
  copyLabel: string;
  activeLmkVersion: number;
  recoverability: 'COMPLETE' | 'KNOWN_HISTORICAL_GAPS';
  recoverableVersions: number[];
  unrecoverableVersions: number[];
  bskSha256: string;
  backupId: string | null;
  activeRotationId: string | null;
}

export interface WriteLmkEscrowBundleOptions {
  mountPath: string;
  filename: string;
  /** Unit tests only. Production callers must require a dedicated mount. */
  requireDedicatedMount?: boolean;
}

export interface LmkEscrowWriteReceipt extends LmkEscrowVerificationReport {
  path: string;
  bytes: number;
  fullFileSha256: string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid timestamp in LMK escrow source: ${String(value)}`);
  }
  return date.toISOString();
}

function sha256(buffer: Buffer): Buffer {
  return createHash('sha256').update(buffer).digest();
}

function sha256Hex(buffer: Buffer): string {
  return sha256(buffer).toString('hex');
}

function validateCopyLabel(label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(label)) {
    throw new Error('Copy label must be 1-32 characters: letters, digits, _ or -');
  }
}

function validateWrappedLmk(bsk: Buffer, wrapped: Buffer, version: number): void {
  if (wrapped.length !== WRAPPED_LMK_BYTES) {
    throw new Error(
      `LMK version ${String(version)} has ${String(wrapped.length)} wrapped bytes; expected ${String(WRAPPED_LMK_BYTES)}`,
    );
  }
  if (wrapped[0] !== 0x01) {
    throw new Error(`LMK version ${String(version)} uses an unsupported wrap format`);
  }

  const nonce = wrapped.subarray(1, 13);
  const ciphertext = wrapped.subarray(13, 45);
  const tag = wrapped.subarray(45, 61);
  const decipher = createDecipheriv('aes-256-gcm', bsk, nonce);
  decipher.setAAD(Buffer.from(`lmk_version=${String(version)}`, 'utf8'));
  decipher.setAuthTag(tag);

  let material: Buffer | null = null;
  let finalBlock: Buffer | null = null;
  try {
    material = decipher.update(ciphertext);
    finalBlock = decipher.final();
    if (material.length + finalBlock.length !== BSK_BYTES) {
      throw new Error(`LMK version ${String(version)} did not unwrap to 32 bytes`);
    }
  } catch (error) {
    throw new Error(
      `LMK version ${String(version)} cannot be authenticated with this BSK: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    material?.fill(0);
    finalBlock?.fill(0);
  }
}

function buildMetadata(options: BuildLmkEscrowBundleOptions): LmkEscrowMetadataV1 {
  const { snapshot } = options;
  validateCopyLabel(options.copyLabel);
  if (options.bsk.length !== BSK_BYTES) {
    throw new Error(`BSK must be exactly ${String(BSK_BYTES)} bytes`);
  }
  if (snapshot.versions.length === 0) {
    throw new Error('No positive LMK versions were found in PostgreSQL');
  }
  if (snapshot.versions.length > MAX_LMK_VERSIONS) {
    throw new Error('LMK version count exceeds the escrow format limit');
  }

  const versions = [...snapshot.versions].sort((left, right) => left.version - right.version);
  const seen = new Set<number>();
  for (const version of versions) {
    if (!Number.isSafeInteger(version.version) || version.version <= 0 || seen.has(version.version)) {
      throw new Error(`Invalid or duplicate LMK version: ${String(version.version)}`);
    }
    seen.add(version.version);
    if (version.wrappedLmk !== null) {
      validateWrappedLmk(options.bsk, version.wrappedLmk, version.version);
    }
  }

  const active = versions.filter((version) => version.status === 'ACTIVE');
  if (active.length !== 1) {
    throw new Error(`Expected exactly one ACTIVE positive LMK version, found ${String(active.length)}`);
  }
  if (active[0]?.wrappedLmk === null) {
    throw new Error(`ACTIVE LMK version ${String(active[0].version)} has no recoverable material`);
  }

  if (snapshot.backup === null && !options.allowUnboundBackup) {
    throw new Error('A VERIFIED backup binding is required (or explicitly use the lab-only unbound mode)');
  }
  if (
    snapshot.backup !== null &&
    snapshot.activeRotation !== null &&
    snapshot.activeRotation.startedAt !== null &&
    snapshot.backup.completedAt.valueOf() < snapshot.activeRotation.startedAt.valueOf()
  ) {
    throw new Error(
      `Backup ${snapshot.backup.id} predates active rotation ${snapshot.activeRotation.rotationId}`,
    );
  }

  const backup: LmkEscrowMetadataV1['backup'] = snapshot.backup === null
    ? { state: 'UNBOUND_LAB_ONLY' }
    : {
        state: 'VERIFIED',
        id: snapshot.backup.id,
        filename: snapshot.backup.filename,
        checksum: snapshot.backup.checksum,
        encrypted: true,
        completedAt: toIso(snapshot.backup.completedAt) ?? '',
        verifiedAt: toIso(snapshot.backup.verifiedAt) ?? '',
      };

  return {
    format: 'znvault-lmk-escrow',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    copyLabel: options.copyLabel,
    operator: options.operator,
    source: {
      hostname: options.hostname,
      vaultVersion: options.vaultVersion,
      cliVersion: options.cliVersion,
      nodeVersion: process.version,
      databaseName: snapshot.databaseName,
      postgresVersion: snapshot.postgresVersion,
      capturedAt: toIso(snapshot.capturedAt) ?? '',
      walLsn: snapshot.walLsn,
      transactionSnapshot: snapshot.transactionSnapshot,
      latestMigration: snapshot.latestMigration,
    },
    backup,
    bskSha256: sha256Hex(options.bsk),
    activeLmkVersion: active[0].version,
    allAvailableVersionsRecoverable: versions.every((version) => version.wrappedLmk !== null),
    lmkVersions: versions.map((version) => ({
      version: version.version,
      keyId: version.keyId,
      status: version.status,
      createdAt: toIso(version.createdAt),
      activatedAt: toIso(version.activatedAt),
      deprecatedAt: toIso(version.deprecatedAt),
      retiredAt: toIso(version.retiredAt),
      description: version.description,
      createdBy: version.createdBy,
      rotatedFromVersion: version.rotatedFromVersion,
      deksMigratedCount: version.deksMigratedCount,
      deksPendingCount: version.deksPendingCount,
      materialState: version.wrappedLmk === null ? 'UNRECOVERABLE' : 'WRAPPED',
      wrappedBytes: version.wrappedLmk?.length ?? 0,
    })),
    auditHead: snapshot.auditHead === null ? null : {
      id: snapshot.auditHead.id,
      timestamp: toIso(snapshot.auditHead.timestamp),
      currentHmacBase64: snapshot.auditHead.currentHmac.toString('base64'),
      lmkVersion: snapshot.auditHead.lmkVersion,
      hmacFormatVersion: snapshot.auditHead.hmacFormatVersion,
    },
    activeRotation: snapshot.activeRotation === null ? null : {
      rotationId: snapshot.activeRotation.rotationId,
      oldLmkVersion: snapshot.activeRotation.oldLmkVersion,
      newLmkVersion: snapshot.activeRotation.newLmkVersion,
      status: snapshot.activeRotation.status,
      startedAt: toIso(snapshot.activeRotation.startedAt),
    },
  };
}

/**
 * Build the compact binary custody bundle entirely in memory. Callers must
 * overwrite the returned Buffer after the direct write completes.
 */
export function buildLmkEscrowBundle(options: BuildLmkEscrowBundleOptions): Buffer {
  const metadata = buildMetadata(options);
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  if (metadataBytes.length > MAX_METADATA_BYTES) {
    throw new Error('LMK escrow metadata exceeds the format limit');
  }

  const versions = [...options.snapshot.versions].sort((left, right) => left.version - right.version);
  const fixed = Buffer.alloc(MAGIC.length + 2 + 4 + 2 + 2);
  let offset = 0;
  MAGIC.copy(fixed, offset);
  offset += MAGIC.length;
  fixed.writeUInt16BE(FORMAT_VERSION, offset);
  offset += 2;
  fixed.writeUInt32BE(metadataBytes.length, offset);
  offset += 4;
  fixed.writeUInt16BE(options.bsk.length, offset);
  offset += 2;
  fixed.writeUInt16BE(versions.length, offset);

  const bskCopy = Buffer.from(options.bsk);
  const rowBuffers = versions.map((version) => {
    const wrappedLength = version.wrappedLmk?.length ?? 0;
    const row = Buffer.alloc(4 + 2 + wrappedLength);
    row.writeUInt32BE(version.version, 0);
    row.writeUInt16BE(wrappedLength, 4);
    version.wrappedLmk?.copy(row, 6);
    return row;
  });

  const body = Buffer.concat([fixed, metadataBytes, bskCopy, ...rowBuffers]);
  const digest = sha256(body);
  const bundle = Buffer.concat([body, digest]);

  bskCopy.fill(0);
  body.fill(0);
  for (const row of rowBuffers) row.fill(0);

  if (bundle.length > MAX_BUNDLE_BYTES) {
    bundle.fill(0);
    throw new Error('LMK escrow bundle exceeds the format limit');
  }
  return bundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function validateSafeIdentifier(value: unknown, field: string): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new Error(`Invalid ${field} in LMK escrow metadata`);
  }
}

function validateIsoTimestamp(value: unknown, field: string): void {
  if (typeof value !== 'string' || toIso(value) !== value) {
    throw new Error(`Invalid ${field} in LMK escrow metadata`);
  }
}

function validateMetadata(decoded: Record<string, unknown>): void {
  if (typeof decoded.copyLabel !== 'string') {
    throw new Error('LMK escrow metadata has an invalid copy label');
  }
  validateCopyLabel(decoded.copyLabel);
  validateIsoTimestamp(decoded.createdAt, 'creation timestamp');

  if (
    typeof decoded.bskSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(decoded.bskSha256)
  ) {
    throw new Error('LMK escrow metadata has an invalid BSK fingerprint');
  }
  if (!isPositiveSafeInteger(decoded.activeLmkVersion)) {
    throw new Error('LMK escrow metadata has an invalid active LMK version');
  }
  if (typeof decoded.allAvailableVersionsRecoverable !== 'boolean') {
    throw new Error('LMK escrow metadata has an invalid recoverability summary');
  }

  if (!Array.isArray(decoded.lmkVersions) || decoded.lmkVersions.length === 0) {
    throw new Error('LMK escrow metadata has no LMK version inventory');
  }
  if (decoded.lmkVersions.length > MAX_LMK_VERSIONS) {
    throw new Error('LMK escrow metadata exceeds the LMK version limit');
  }
  for (const [index, value] of decoded.lmkVersions.entries()) {
    if (!isRecord(value)) {
      throw new Error(`LMK escrow metadata version ${String(index)} is not an object`);
    }
    if (!isPositiveSafeInteger(value.version)) {
      throw new Error(`LMK escrow metadata version ${String(index)} has an invalid number`);
    }
    if (!['ACTIVE', 'DEPRECATED', 'RETIRED'].includes(String(value.status))) {
      throw new Error(`LMK version ${String(value.version)} has an invalid status`);
    }
    if (value.materialState !== 'WRAPPED' && value.materialState !== 'UNRECOVERABLE') {
      throw new Error(`LMK version ${String(value.version)} has an invalid material state`);
    }
    if (
      !Number.isSafeInteger(value.wrappedBytes) ||
      typeof value.wrappedBytes !== 'number' ||
      value.wrappedBytes < 0
    ) {
      throw new Error(`LMK version ${String(value.version)} has an invalid wrapped byte count`);
    }
  }

  if (!isRecord(decoded.backup)) {
    throw new Error('LMK escrow metadata has an invalid backup binding');
  }
  if (decoded.backup.state === 'VERIFIED') {
    validateSafeIdentifier(decoded.backup.id, 'backup ID');
  } else if (decoded.backup.state !== 'UNBOUND_LAB_ONLY') {
    throw new Error('LMK escrow metadata has an invalid backup state');
  }

  if (decoded.activeRotation !== null) {
    if (!isRecord(decoded.activeRotation)) {
      throw new Error('LMK escrow metadata has an invalid active rotation');
    }
    validateSafeIdentifier(decoded.activeRotation.rotationId, 'rotation ID');
  }
}

function parseMetadata(bytes: Buffer): LmkEscrowMetadataV1 {
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Invalid LMK escrow metadata JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(decoded)) throw new Error('LMK escrow metadata must be an object');
  if (decoded.format !== 'znvault-lmk-escrow' || decoded.formatVersion !== FORMAT_VERSION) {
    throw new Error('LMK escrow metadata format/version mismatch');
  }
  validateMetadata(decoded);
  return decoded as unknown as LmkEscrowMetadataV1;
}

function parseBundle(bundle: Buffer): ParsedBundle {
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error('LMK escrow bundle is too large');
  const minimum = MAGIC.length + 2 + 4 + 2 + 2 + BSK_BYTES + DIGEST_BYTES;
  if (bundle.length < minimum) throw new Error('LMK escrow bundle is truncated');

  const bodyEnd = bundle.length - DIGEST_BYTES;
  const actualDigest = bundle.subarray(bodyEnd);
  const expectedDigest = sha256(bundle.subarray(0, bodyEnd));
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    throw new Error('LMK escrow bundle checksum mismatch');
  }

  let offset = 0;
  if (!timingSafeEqual(bundle.subarray(0, MAGIC.length), MAGIC)) {
    throw new Error('LMK escrow bundle magic mismatch');
  }
  offset += MAGIC.length;
  const version = bundle.readUInt16BE(offset);
  offset += 2;
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported LMK escrow format version: ${String(version)}`);
  }

  const metadataLength = bundle.readUInt32BE(offset);
  offset += 4;
  const bskLength = bundle.readUInt16BE(offset);
  offset += 2;
  const versionCount = bundle.readUInt16BE(offset);
  offset += 2;
  if (metadataLength > MAX_METADATA_BYTES || offset + metadataLength > bodyEnd) {
    throw new Error('Invalid LMK escrow metadata length');
  }
  if (bskLength !== BSK_BYTES) throw new Error('Invalid BSK length in LMK escrow bundle');
  if (versionCount === 0 || versionCount > MAX_LMK_VERSIONS) {
    throw new Error('Invalid LMK version count in escrow bundle');
  }

  const metadata = parseMetadata(bundle.subarray(offset, offset + metadataLength));
  offset += metadataLength;
  if (offset + bskLength > bodyEnd) throw new Error('LMK escrow bundle is truncated before the BSK');
  const bsk = Buffer.from(bundle.subarray(offset, offset + bskLength));
  offset += bskLength;

  const wrappedLmks: ParsedBundle['wrappedLmks'] = [];
  try {
    for (let index = 0; index < versionCount; index += 1) {
      if (offset + 6 > bodyEnd) throw new Error('LMK escrow bundle is truncated in a version record');
      const lmkVersion = bundle.readUInt32BE(offset);
      offset += 4;
      const wrappedLength = bundle.readUInt16BE(offset);
      offset += 2;
      if (wrappedLength !== 0 && wrappedLength !== WRAPPED_LMK_BYTES) {
        throw new Error(`Invalid wrapped length for LMK version ${String(lmkVersion)}`);
      }
      if (offset + wrappedLength > bodyEnd) throw new Error('LMK escrow bundle is truncated in wrapped material');
      const wrapped = wrappedLength === 0
        ? null
        : Buffer.from(bundle.subarray(offset, offset + wrappedLength));
      offset += wrappedLength;
      wrappedLmks.push({ version: lmkVersion, wrapped });
    }

    if (offset !== bodyEnd) throw new Error('LMK escrow bundle contains trailing data');
    return { metadata, bsk, wrappedLmks, bundleDigest: Buffer.from(actualDigest) };
  } catch (error) {
    bsk.fill(0);
    for (const row of wrappedLmks) row.wrapped?.fill(0);
    throw error;
  }
}

function zeroiseParsedBundle(parsed: ParsedBundle): void {
  parsed.bsk.fill(0);
  parsed.bundleDigest.fill(0);
  for (const row of parsed.wrappedLmks) row.wrapped?.fill(0);
}

function validateParsedBundle(parsed: ParsedBundle): LmkEscrowVerificationReport {
    if (parsed.metadata.bskSha256 !== sha256Hex(parsed.bsk)) {
      throw new Error('BSK fingerprint does not match the escrow metadata');
    }
    if (parsed.metadata.lmkVersions.length !== parsed.wrappedLmks.length) {
      throw new Error('LMK inventory count does not match binary records');
    }

    const recoverableVersions: number[] = [];
    const unrecoverableVersions: number[] = [];
    const seen = new Set<number>();
    let activeCount = 0;
    let activeVersion: number | null = null;

    for (let index = 0; index < parsed.wrappedLmks.length; index += 1) {
      const row = parsed.wrappedLmks[index];
      const metadata = parsed.metadata.lmkVersions[index];
      if (row.version !== metadata.version || seen.has(row.version)) {
        throw new Error('LMK inventory order/version mismatch');
      }
      seen.add(row.version);
      if (metadata.status === 'ACTIVE') {
        activeCount += 1;
        activeVersion = row.version;
      }

      if (row.wrapped === null) {
        if (metadata.materialState !== 'UNRECOVERABLE' || metadata.wrappedBytes !== 0) {
          throw new Error(`LMK version ${String(row.version)} material-state mismatch`);
        }
        unrecoverableVersions.push(row.version);
      } else {
        if (metadata.materialState !== 'WRAPPED' || metadata.wrappedBytes !== row.wrapped.length) {
          throw new Error(`LMK version ${String(row.version)} wrapped-material mismatch`);
        }
        validateWrappedLmk(parsed.bsk, row.wrapped, row.version);
        recoverableVersions.push(row.version);
      }
    }

    if (activeCount !== 1) throw new Error(`Expected one ACTIVE LMK, found ${String(activeCount)}`);
    if (activeVersion !== parsed.metadata.activeLmkVersion) {
      throw new Error('ACTIVE LMK version does not match the escrow metadata summary');
    }
    if (!recoverableVersions.includes(parsed.metadata.activeLmkVersion)) {
      throw new Error('The ACTIVE LMK is not recoverable from this bundle');
    }
    const complete = unrecoverableVersions.length === 0;
    if (parsed.metadata.allAvailableVersionsRecoverable !== complete) {
      throw new Error('Recoverability summary does not match LMK inventory');
    }

    return {
      valid: true,
      formatVersion: 1,
      bundleId: `sha256:${parsed.bundleDigest.toString('hex')}`,
      createdAt: parsed.metadata.createdAt,
      copyLabel: parsed.metadata.copyLabel,
      activeLmkVersion: parsed.metadata.activeLmkVersion,
      recoverability: complete ? 'COMPLETE' : 'KNOWN_HISTORICAL_GAPS',
      recoverableVersions,
      unrecoverableVersions,
      bskSha256: parsed.metadata.bskSha256,
      backupId: parsed.metadata.backup.state === 'VERIFIED' ? parsed.metadata.backup.id : null,
      activeRotationId: parsed.metadata.activeRotation?.rotationId ?? null,
    };
}

export function verifyLmkEscrowBundleBuffer(bundle: Buffer): LmkEscrowVerificationReport {
  const parsed = parseBundle(bundle);
  try {
    return validateParsedBundle(parsed);
  } finally {
    zeroiseParsedBundle(parsed);
  }
}

/**
 * Run the full bundle verification and hand the live bootstrap key to `fn`.
 *
 * The key is never returned: it is valid only for the duration of the
 * callback and is zeroised afterwards, on success and on failure alike.
 * Callers must not copy it, log it, or let it escape the callback.
 *
 * Verification is not a formality here. It proves cryptographically that this
 * BSK unwraps the LMK versions the bundle carries, so a bundle that passes has
 * the right key, not merely a well-formed one.
 */
export function withVerifiedBootstrapKey<T>(
  bundle: Buffer,
  fn: (bsk: Buffer, report: LmkEscrowVerificationReport) => T,
): T {
  const parsed = parseBundle(bundle);
  try {
    const report = validateParsedBundle(parsed);
    return fn(parsed.bsk, report);
  } finally {
    zeroiseParsedBundle(parsed);
  }
}

function assertSafeDestination(mountPath: string, requireDedicatedMount: boolean): string {
  if (!isAbsolute(mountPath)) throw new Error('Escrow mount path must be absolute');
  const normalized = normalize(resolve(mountPath));
  const mountStat = lstatSync(normalized);
  if (mountStat.isSymbolicLink() || !mountStat.isDirectory()) {
    throw new Error('Escrow destination must be a real directory, not a symlink');
  }
  const canonical = realpathSync(normalized);

  if (requireDedicatedMount) {
    const allowedPrefixes = [
      `${sep}Volumes${sep}`,
      `${sep}media${sep}`,
      `${sep}run${sep}media${sep}`,
      `${sep}mnt${sep}`,
    ];
    if (!allowedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error('Escrow destination must be under /Volumes, /media, /run/media or /mnt');
    }
    if (canonical !== normalized) {
      throw new Error('Escrow destination path may not contain symlinks');
    }
    const parent = dirname(normalized);
    if (parent === normalized || statSync(parent).dev === statSync(normalized).dev) {
      throw new Error('Escrow destination is not the root of a dedicated mounted filesystem');
    }
  }
  return requireDedicatedMount ? normalized : canonical;
}

export function makeLmkEscrowFilename(report: LmkEscrowVerificationReport): string {
  validateCopyLabel(report.copyLabel);
  const timestamp = report.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const digest = report.bundleId.slice('sha256:'.length, 'sha256:'.length + 12);
  return `znvault-lmk-escrow-v1-active-v${String(report.activeLmkVersion)}-${report.copyLabel}-${timestamp}-${digest}.znlmk`;
}

/**
 * Write once to the final filename, flush, reopen from the destination and
 * verify. A failed/partial final file is deliberately retained for evidence;
 * the filename can never be reused because O_EXCL is mandatory.
 */
export function writeLmkEscrowBundleDirect(
  bundle: Buffer,
  options: WriteLmkEscrowBundleOptions,
): LmkEscrowWriteReceipt {
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error('LMK escrow bundle is too large');
  if (options.filename.includes(sep) || options.filename === '' || options.filename === '.' || options.filename === '..') {
    throw new Error('Escrow filename must be a single path component');
  }
  const mountPath = assertSafeDestination(options.mountPath, options.requireDedicatedMount !== false);
  const destination = join(mountPath, options.filename);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
  let descriptor: number | null = null;

  try {
    descriptor = openSync(destination, flags, 0o600);
    fchmodSync(descriptor, 0o600);
    let offset = 0;
    while (offset < bundle.length) {
      const written = writeSync(descriptor, bundle, offset, bundle.length - offset);
      if (written <= 0) throw new Error('Escrow device returned a zero-byte write');
      offset += written;
    }
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }

  const persisted = readFileSync(destination);
  try {
    if (persisted.length !== bundle.length || !timingSafeEqual(persisted, bundle)) {
      throw new Error(`Escrow read-back mismatch; retain the failed file at ${destination}`);
    }
    const report = verifyLmkEscrowBundleBuffer(persisted);

    const directoryDescriptor = openSync(mountPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }

    return {
      ...report,
      path: destination,
      bytes: persisted.length,
      fullFileSha256: sha256Hex(persisted),
    };
  } finally {
    persisted.fill(0);
  }
}

export function readAndVerifyLmkEscrowBundle(filePath: string): LmkEscrowVerificationReport {
  const absolute = resolve(filePath);
  const fileStat = lstatSync(absolute);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error('Escrow bundle must be a regular file, not a symlink');
  }
  if (fileStat.size > MAX_BUNDLE_BYTES) throw new Error('LMK escrow bundle is too large');
  const bundle = readFileSync(absolute);
  try {
    return verifyLmkEscrowBundleBuffer(bundle);
  } finally {
    bundle.fill(0);
  }
}
