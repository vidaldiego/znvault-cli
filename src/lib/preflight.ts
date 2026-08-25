// Path: src/lib/preflight.ts
//
// Read-only preflight for a bootstrap-key (BSK) rotation: what the database
// says about the key hierarchy, evaluated against gates, as an artefact.
//
// Two design decisions carry the whole module.
//
// 1. THE GATES ARE A PURE FUNCTION OF THE CAPTURED BODY. Nothing here reads a
//    database, a clock, a file or an environment variable. The same function
//    runs at capture time and again when the evidence is verified later, so an
//    artefact whose `gates` block disagrees with its own contents can be
//    caught. A gate that consulted anything outside its argument would make
//    that cross-check diverge for innocent reasons, and a cross-check that
//    cries wolf gets softened until it means nothing.
//
// 2. BLOCKING AND INFORMATIONAL ARE DIFFERENT THINGS. This deployment HAS
//    deprecated LMK versions with no wrapped material, and it has a version-0
//    placeholder that every boot re-seeds as ACTIVE. If those failed the run,
//    the preflight would be red on a healthy cluster, and the first operator
//    under time pressure would find the override — defeating every other gate
//    in the same keystroke. A gate that is always red protects nothing.
//
// What is deliberately NOT here: any key material. Wrapped LMKs are reported
// as a byte count, never as bytes. Envelope KCVs are truncated MACs by
// construction and are the only fingerprints the artefact carries.

import { isBskKcv } from './kcv.js';

export interface PreflightLmkVersion {
  version: number;
  status: string;
  hasWrappedLmk: boolean;
  wrappedBytes: number;
}

export interface PreflightEnvelope {
  providerId: string;
  providerType: string;
  keyId: string | null;
  kcv: string;
}

export interface PreflightRotation {
  rotationId: string;
  oldLmkVersion: number;
  newLmkVersion: number;
  status: string;
  startedAt: string | null;
}

/**
 * The inventory as the server sends it (`GET /v1/superadmin/lmk/preflight`).
 *
 * Declared here, beside the artifact types it feeds, because it IS the same
 * data — the wire shape and the evidence shape must not drift apart, and two
 * copies in two files is how they would.
 */
export interface PreflightSnapshotResponse {
  capturedAt: string;
  databaseName: string;
  postgresVersion: string;
  walLsn: string;
  transactionSnapshot: string;
  latestMigration: string | null;
  lmkVersions: PreflightLmkVersion[];
  rootKeyEnvelopes: PreflightEnvelope[];
  rootKeyEnvelopesTablePresent: boolean;
  activeRotations: PreflightRotation[];
  auditHead: PreflightAuditHead | null;
  latestVerifiedBackup: PreflightBackup | null;
}

export interface PreflightAuditHead {
  id: string;
  timestamp: string | null;
  currentHmacBase64: string;
  lmkVersion: number;
  hmacFormatVersion: number;
}

export interface PreflightBackup {
  id: string;
  filename: string;
  completedAt: string;
  verifiedAt: string;
}

/**
 * The signed-in-A2 body. Everything a gate needs must live in here: a gate
 * that reaches outside this object cannot be re-evaluated from the artefact.
 */
export interface PreflightBody {
  /** In-band artefact tag, so a file cannot be mistaken for another format. */
  artifact: 'znvault-preflight-v1';
  capturedAt: string;
  cliVersion: string;
  operator: string;
  hostname: string;
  database: {
    databaseName: string;
    postgresVersion: string;
    walLsn: string;
    transactionSnapshot: string;
    latestMigration: string | null;
  };
  lmkVersions: PreflightLmkVersion[];
  rootKeyEnvelopes: PreflightEnvelope[];
  rootKeyEnvelopesTablePresent: boolean;
  activeRotations: PreflightRotation[];
  auditHead: PreflightAuditHead | null;
  latestVerifiedBackup: PreflightBackup | null;
}

export type GateStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

/**
 * BLOCKING failures set the exit code. INFORMATIONAL failures are recorded and
 * do not — see the module header for why the distinction is load-bearing
 * rather than cosmetic.
 */
export type GateSeverity = 'BLOCKING' | 'INFORMATIONAL';

export interface PreflightGate {
  id: string;
  severity: GateSeverity;
  status: GateStatus;
  /** One line an operator can act on. Never key material. */
  detail: string;
}

export type PreflightVerdict = 'GREEN' | 'RED';

/**
 * Versions at or below zero are not real key generations.
 *
 * `models.postgres.sql` seeds `version=0, status='ACTIVE',
 * key_id='ZK_MODE_PLACEHOLDER'` on EVERY boot, and migration 062 forces it back
 * to ACTIVE if anything changes it. Every rule about "the ACTIVE version" in
 * this file therefore has to say `version > 0`, and the one place that forgets
 * turns a healthy cluster red.
 */
function positiveVersions(body: PreflightBody): PreflightLmkVersion[] {
  return body.lmkVersions.filter((v) => v.version > 0);
}

function pass(id: string, severity: GateSeverity, detail: string): PreflightGate {
  return { id, severity, status: 'PASS', detail };
}

function fail(id: string, severity: GateSeverity, detail: string): PreflightGate {
  return { id, severity, status: 'FAIL', detail };
}

function notApplicable(id: string, severity: GateSeverity, detail: string): PreflightGate {
  return { id, severity, status: 'NOT_APPLICABLE', detail };
}

/**
 * Evaluate every gate over a captured body.
 *
 * Pure: same input, same output, no side effects, no ambient state.
 */
export function evaluateGates(body: PreflightBody): PreflightGate[] {
  const gates: PreflightGate[] = [];
  const positives = positiveVersions(body);
  const actives = positives.filter((v) => v.status === 'ACTIVE');

  // --- BLOCKING -------------------------------------------------------------

  gates.push(
    actives.length === 1
      ? pass(
          'exactly_one_positive_active',
          'BLOCKING',
          `LMK version ${String(actives[0].version)} is the only ACTIVE version above zero`,
        )
      : fail(
          'exactly_one_positive_active',
          'BLOCKING',
          actives.length === 0
            ? 'No LMK version above zero is ACTIVE. A node booting now cannot resolve a current key.'
            : `Found ${String(actives.length)} ACTIVE LMK versions above zero: ` +
              `${actives.map((v) => String(v.version)).join(', ')}. ` +
              'Exactly one must be ACTIVE before any key-lifecycle operation.',
        ),
  );

  if (actives.length === 1) {
    const active = actives[0];
    gates.push(
      active.hasWrappedLmk
        ? pass(
            'active_version_has_material',
            'BLOCKING',
            `ACTIVE version ${String(active.version)} carries ${String(active.wrappedBytes)} bytes of wrapped material`,
          )
        : fail(
            'active_version_has_material',
            'BLOCKING',
            `ACTIVE version ${String(active.version)} has no wrapped_lmk. ` +
            'The current key cannot be unwrapped from this database.',
          ),
    );
  } else {
    // Two diagnoses at once send the operator to fix the wrong one.
    gates.push(
      notApplicable(
        'active_version_has_material',
        'BLOCKING',
        'Not evaluated: there is not exactly one ACTIVE version above zero',
      ),
    );
  }

  const malformed = body.rootKeyEnvelopes.filter((e) => !isBskKcv(e.kcv));
  gates.push(
    malformed.length === 0
      ? pass(
          'envelope_kcv_format',
          'BLOCKING',
          `${String(body.rootKeyEnvelopes.length)} envelope KCVs are well-formed kcv1: fingerprints`,
        )
      : fail(
          'envelope_kcv_format',
          'BLOCKING',
          `Envelope KCV is not a kcv1: fingerprint for provider(s): ` +
          `${malformed.map((e) => e.providerId).join(', ')}. ` +
          'This value would be republished into evidence leaving the CPD.',
        ),
  );

  const distinctKcvs = [...new Set(body.rootKeyEnvelopes.map((e) => e.kcv))];
  if (body.rootKeyEnvelopes.length < 2) {
    gates.push(
      notApplicable(
        'envelope_kcv_agreement',
        'BLOCKING',
        `Not evaluated: ${String(body.rootKeyEnvelopes.length)} envelope(s) recorded`,
      ),
    );
  } else {
    gates.push(
      distinctKcvs.length === 1
        ? pass(
            'envelope_kcv_agreement',
            'BLOCKING',
            `All ${String(body.rootKeyEnvelopes.length)} envelopes wrap the same key (${distinctKcvs[0]})`,
          )
        : fail(
            'envelope_kcv_agreement',
            'BLOCKING',
            `Envelopes wrap ${String(distinctKcvs.length)} DIFFERENT keys: ` +
            body.rootKeyEnvelopes.map((e) => `${e.providerId}=${e.kcv}`).join(', ') +
            '. Which key a node boots with depends on provider order.',
          ),
    );
  }

  gates.push(
    body.activeRotations.length === 0
      ? pass('no_rotation_in_progress', 'BLOCKING', 'No LMK rotation is in progress or failed')
      : fail(
          'no_rotation_in_progress',
          'BLOCKING',
          'LMK rotation(s) not finished: ' +
          body.activeRotations
            .map((r) => `${r.rotationId} (${r.status}, v${String(r.oldLmkVersion)}→v${String(r.newLmkVersion)})`)
            .join(', ') +
          '. A FAILED rotation is not over: some DEKs may already be wrapped under the new version.',
        ),
  );

  // --- INFORMATIONAL --------------------------------------------------------

  const gaps = positives.filter((v) => v.status !== 'ACTIVE' && !v.hasWrappedLmk);
  gates.push(
    gaps.length === 0
      ? pass(
          'historical_versions_without_material',
          'INFORMATIONAL',
          'Every LMK version above zero has wrapped material',
        )
      : fail(
          'historical_versions_without_material',
          'INFORMATIONAL',
          `Version(s) with no wrapped material: ${gaps.map((v) => String(v.version)).join(', ')}. ` +
          'Already modelled by the escrow bundle as unrecoverableVersions; not a blocker.',
        ),
  );

  gates.push(
    body.rootKeyEnvelopesTablePresent
      ? pass(
          'root_key_envelopes_present',
          'INFORMATIONAL',
          `root_key_envelopes holds ${String(body.rootKeyEnvelopes.length)} envelope(s)`,
        )
      : fail(
          'root_key_envelopes_present',
          'INFORMATIONAL',
          'root_key_envelopes does not exist (migration 092 not applied here). ' +
          'The BSK has no external root of trust recorded in this database.',
        ),
  );

  gates.push(
    body.latestVerifiedBackup
      ? pass(
          'verified_backup_available',
          'INFORMATIONAL',
          `Latest VERIFIED backup ${body.latestVerifiedBackup.id} verified at ${body.latestVerifiedBackup.verifiedAt}`,
        )
      : fail(
          'verified_backup_available',
          'INFORMATIONAL',
          'No VERIFIED backup recorded. An escrow snapshot requires one; this preflight does not.',
        ),
  );

  return gates;
}

/**
 * RED when any BLOCKING gate failed; informational failures never change it.
 *
 * `NOT_APPLICABLE` on a blocking gate does not turn the run red on its own —
 * the condition that made it inapplicable is itself reported by another
 * blocking gate, and double-counting it would only obscure which one to fix.
 */
export function overallVerdict(gates: PreflightGate[]): PreflightVerdict {
  return gates.some((g) => g.severity === 'BLOCKING' && g.status === 'FAIL') ? 'RED' : 'GREEN';
}

/** The full artefact: the captured body plus the gates evaluated over it. */
export interface PreflightEvidence extends PreflightBody {
  gates: PreflightGate[];
  verdict: PreflightVerdict;
}

export function buildEvidence(body: PreflightBody): PreflightEvidence {
  const gates = evaluateGates(body);
  return { ...body, gates, verdict: overallVerdict(gates) };
}
