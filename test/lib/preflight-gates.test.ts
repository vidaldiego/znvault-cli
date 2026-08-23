// Path: test/lib/preflight-gates.test.ts
//
// The gates are the whole point of the preflight, and they are a pure function
// of the captured body on purpose: the same function runs at capture time and
// again at verification time (A2), so a signed artefact whose `gates` block
// disagrees with its own contents is detectable. That only works if the
// function never reads the database, the clock, or the environment.
//
// The traps below are all real and all verified against this deployment:
//
//   VERSION 0 IS ALWAYS ACTIVE. `models.postgres.sql` seeds
//   `version=0, status='ACTIVE', key_id='ZK_MODE_PLACEHOLDER'` on EVERY boot,
//   and migration 062 forces it back to ACTIVE if anything changes it. Any
//   "exactly one ACTIVE" check that forgets `version > 0` is red on a perfectly
//   healthy cluster — and would be "fixed" by whoever is under pressure to
//   start a rotation.
//
//   HISTORICAL GAPS ARE NOT FAILURES. Deprecated and retired versions with no
//   wrapped material exist in this deployment and are already modelled by the
//   escrow bundle as `unrecoverableVersions`. Treating them as blocking would
//   make the preflight permanently red, which trains an operator to pass
//   `--force` and defeats every other gate at the same time.
//
//   TWO ENVELOPES CAN WRAP DIFFERENT KEYS. Nothing in the schema prevents it
//   (`kcv` is TEXT with no constraint), and the consequence is that which key
//   a node boots with depends on which provider answers first. That is the one
//   gate here that is not in the original plan; it is blocking because a green
//   preflight over that state would be actively false.

import { describe, expect, it } from 'vitest';
import {
  evaluateGates,
  overallVerdict,
  type PreflightBody,
} from '../../src/lib/preflight.js';

const KCV_A = 'kcv1:0aefffaf36e10342c827e949f8276fd8';
const KCV_B = 'kcv1:c25a0581ab054cc16e32a168a9ad22bb';

function healthyBody(overrides: Partial<PreflightBody> = {}): PreflightBody {
  return {
    artifact: 'znvault-preflight-v1',
    capturedAt: '2026-08-23T10:00:00.000Z',
    cliVersion: '4.21.0',
    operator: 'operator@example.com',
    hostname: 'vault-node',
    database: {
      databaseName: 'znvault',
      postgresVersion: '17.5',
      walLsn: '0/16B6C50',
      transactionSnapshot: '100:100:',
      latestMigration: '093_key_lifecycle_operations',
    },
    lmkVersions: [
      { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
      { version: 3, status: 'DEPRECATED', hasWrappedLmk: true, wrappedBytes: 60 },
      { version: 4, status: 'ACTIVE', hasWrappedLmk: true, wrappedBytes: 60 },
    ],
    rootKeyEnvelopes: [
      { providerId: 'sentinel', providerType: 'sentinel', keyId: null, kcv: KCV_A },
      { providerId: 'aws-kms', providerType: 'aws-kms', keyId: 'alias/example', kcv: KCV_A },
    ],
    rootKeyEnvelopesTablePresent: true,
    activeRotations: [],
    auditHead: {
      id: '260001',
      timestamp: '2026-08-23T09:59:00.000Z',
      currentHmacBase64: 'ZGVhZGJlZWY=',
      lmkVersion: 4,
      hmacFormatVersion: 2,
    },
    latestVerifiedBackup: {
      id: 'backup_1',
      filename: 'znvault-2026-08-23.tar.gz',
      completedAt: '2026-08-23T02:00:00.000Z',
      verifiedAt: '2026-08-23T02:05:00.000Z',
    },
    ...overrides,
  };
}

function gate(body: PreflightBody, id: string) {
  const found = evaluateGates(body).find((g) => g.id === id);
  if (!found) throw new Error(`no gate with id ${id}`);
  return found;
}

describe('evaluateGates', () => {
  it('passes every blocking gate on a healthy deployment', () => {
    const gates = evaluateGates(healthyBody());
    const blocking = gates.filter((g) => g.severity === 'BLOCKING');

    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.filter((g) => g.status === 'FAIL')).toEqual([]);
    expect(overallVerdict(gates)).toBe('GREEN');
  });

  it('is a pure function of its argument', () => {
    // A2 re-runs this over a body read back from a file. If it consulted a
    // clock, an environment variable or a database, the re-evaluation would
    // diverge from the capture for reasons having nothing to do with tampering
    // — and the cross-check would have to be softened until it meant nothing.
    const body = healthyBody();
    const snapshot = JSON.stringify(body);
    const first = evaluateGates(body);
    const second = evaluateGates(JSON.parse(snapshot) as PreflightBody);
    expect(second).toEqual(first);
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  describe('exactly_one_positive_active', () => {
    it('ignores the version-0 placeholder that every boot re-seeds as ACTIVE', () => {
      expect(gate(healthyBody(), 'exactly_one_positive_active').status).toBe('PASS');
    });

    it('fails when a second POSITIVE version is ACTIVE', () => {
      const g = gate(
        healthyBody({
          lmkVersions: [
            { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
            { version: 3, status: 'ACTIVE', hasWrappedLmk: true, wrappedBytes: 60 },
            { version: 4, status: 'ACTIVE', hasWrappedLmk: true, wrappedBytes: 60 },
          ],
        }),
        'exactly_one_positive_active',
      );
      expect(g.status).toBe('FAIL');
      expect(g.detail).toContain('3');
      expect(g.detail).toContain('4');
    });

    it('fails when NO positive version is ACTIVE', () => {
      // The state ensureLMKVersionTracking can leave behind, and the state a
      // half-finished rotation leaves. Silent, until the next boot.
      expect(
        gate(
          healthyBody({
            lmkVersions: [
              { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
              { version: 4, status: 'DEPRECATED', hasWrappedLmk: true, wrappedBytes: 60 },
            ],
          }),
          'exactly_one_positive_active',
        ).status,
      ).toBe('FAIL');
    });
  });

  describe('active_version_has_material', () => {
    it('fails when the ACTIVE version carries no wrapped LMK', () => {
      // This is not hypothetical: E2E suite 54 leaves version 95 in exactly
      // this state on the shared test database, and `ensureLMKVersionTracking`
      // can manufacture it in production.
      const g = gate(
        healthyBody({
          lmkVersions: [
            { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
            { version: 4, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
          ],
        }),
        'active_version_has_material',
      );
      expect(g.status).toBe('FAIL');
      expect(g.severity).toBe('BLOCKING');
    });

    it('does not report on the ACTIVE version when there is not exactly one', () => {
      // Reporting "the ACTIVE version has no material" while also reporting
      // "there are two ACTIVE versions" invites the operator to fix the wrong
      // one. One diagnosis at a time.
      expect(
        gate(
          healthyBody({
            lmkVersions: [
              { version: 3, status: 'ACTIVE', hasWrappedLmk: true, wrappedBytes: 60 },
              { version: 4, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
            ],
          }),
          'active_version_has_material',
        ).status,
      ).toBe('NOT_APPLICABLE');
    });
  });

  describe('envelope_kcv_format', () => {
    it('fails on anything that is not a kcv1: fingerprint', () => {
      // `root_key_envelopes.kcv` is TEXT with no CHECK. The preflight
      // REPUBLISHES whatever it holds into evidence that leaves the CPD, so a
      // value of the wrong shape is a protocol violation before it is a
      // mismatch — and it must never be forwarded as if it were a fingerprint.
      const g = gate(
        healthyBody({
          rootKeyEnvelopes: [
            { providerId: 'sentinel', providerType: 'sentinel', keyId: null, kcv: KCV_A },
            {
              providerId: 'aws-kms',
              providerType: 'aws-kms',
              keyId: 'alias/example',
              kcv: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        }),
        'envelope_kcv_format',
      );
      expect(g.status).toBe('FAIL');
      expect(g.detail).toContain('aws-kms');
    });
  });

  describe('envelope_kcv_agreement', () => {
    it('fails when two providers wrap DIFFERENT keys', () => {
      // Which key the node boots with then depends on which provider answers
      // first in ROOT_KEY_PROVIDERS. Rotating on top of that state destroys
      // whichever key loses.
      const g = gate(
        healthyBody({
          rootKeyEnvelopes: [
            { providerId: 'sentinel', providerType: 'sentinel', keyId: null, kcv: KCV_A },
            { providerId: 'aws-kms', providerType: 'aws-kms', keyId: 'k', kcv: KCV_B },
          ],
        }),
        'envelope_kcv_agreement',
      );
      expect(g.status).toBe('FAIL');
      expect(g.severity).toBe('BLOCKING');
    });

    it('is not applicable with fewer than two envelopes', () => {
      expect(
        gate(healthyBody({ rootKeyEnvelopes: [] }), 'envelope_kcv_agreement').status,
      ).toBe('NOT_APPLICABLE');
    });
  });

  describe('no_rotation_in_progress', () => {
    it('fails while an LMK rotation is in flight', () => {
      const g = gate(
        healthyBody({
          activeRotations: [
            {
              rotationId: 'rot-1',
              oldLmkVersion: 4,
              newLmkVersion: 5,
              status: 'IN_PROGRESS',
              startedAt: '2026-08-23T09:00:00.000Z',
            },
          ],
        }),
        'no_rotation_in_progress',
      );
      expect(g.status).toBe('FAIL');
    });

    it('fails on a FAILED rotation too, which is the one people forget', () => {
      // A rotation that failed halfway is not "over". Its row is the only
      // record that some DEKs may be wrapped under the new version already.
      expect(
        gate(
          healthyBody({
            activeRotations: [
              {
                rotationId: 'rot-1',
                oldLmkVersion: 4,
                newLmkVersion: 5,
                status: 'FAILED',
                startedAt: '2026-08-20T09:00:00.000Z',
              },
            ],
          }),
          'no_rotation_in_progress',
        ).status,
      ).toBe('FAIL');
    });
  });

  describe('informational findings do not turn the verdict red', () => {
    it('records historical gaps without failing the run', () => {
      const body = healthyBody({
        lmkVersions: [
          { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
          { version: 1, status: 'RETIRED', hasWrappedLmk: false, wrappedBytes: 0 },
          { version: 4, status: 'ACTIVE', hasWrappedLmk: true, wrappedBytes: 60 },
        ],
      });
      const g = gate(body, 'historical_versions_without_material');

      expect(g.status).toBe('FAIL');
      expect(g.severity).toBe('INFORMATIONAL');
      expect(g.detail).toContain('1');
      // THE point of the split: this deployment has such versions today, and a
      // preflight that is permanently red is a preflight nobody reads.
      expect(overallVerdict(evaluateGates(body))).toBe('GREEN');
    });

    it('records a missing root_key_envelopes table without failing the run', () => {
      const body = healthyBody({
        rootKeyEnvelopes: [],
        rootKeyEnvelopesTablePresent: false,
      });
      expect(gate(body, 'root_key_envelopes_present').severity).toBe('INFORMATIONAL');
      expect(overallVerdict(evaluateGates(body))).toBe('GREEN');
    });

    it('records the absence of a verified backup without failing the run', () => {
      const body = healthyBody({ latestVerifiedBackup: null });
      expect(gate(body, 'verified_backup_available').status).toBe('FAIL');
      expect(gate(body, 'verified_backup_available').severity).toBe('INFORMATIONAL');
      expect(overallVerdict(evaluateGates(body))).toBe('GREEN');
    });
  });

  describe('overallVerdict', () => {
    it('is RED when any BLOCKING gate fails', () => {
      const body = healthyBody({ activeRotations: [] , lmkVersions: [
        { version: 0, status: 'ACTIVE', hasWrappedLmk: false, wrappedBytes: 0 },
      ] });
      expect(overallVerdict(evaluateGates(body))).toBe('RED');
    });
  });
});
