import { describe, expect, it } from 'vitest';
import { normalizeAuditVerification } from '../src/audit-verification.js';
import type { AuditVerificationEvidence } from '../src/audit-verification.js';
const good = {"status": "verified", "valid": true, "reasons": [], "errors": [], "checkedEntries": 3, "readEntries": 3, "authenticatedEntries": 3, "unverifiedEntries": 0, "unsignedDetailsEntries": 0, "scope": "retained", "interval": {"firstId": 5, "lastId": 7}, "completed": true, "startedAt": "2026-11-01T00:00:00Z", "finishedAt": "2026-11-01T00:00:01Z", "consistency": "repeatable_read", "historicalCompleteness": "not_proven"} as AuditVerificationEvidence;
describe('audit verification evidence contract', () => {
  it('preserves coverage, counters, reasons and dates', () => expect(normalizeAuditVerification(good)).toEqual(good));
  it.each(['invalid','unverifiable','error','empty','unknown',undefined])('never blesses %s', status => {
    expect(normalizeAuditVerification({ ...good, status } as AuditVerificationEvidence).valid).toBe(false);
  });
  it.each([{ scope:'tail' }, { completed:false }, { unverifiedEntries:1 }, { unsignedDetailsEntries:1 }, { readEntries:0 }, { authenticatedEntries:2 }])('rejects partial evidence %j', patch => {
    expect(normalizeAuditVerification({ ...good, ...patch } as AuditVerificationEvidence).valid).toBe(false);
  });
  it('rejects favorable legacy booleans with no evidence', () => expect(normalizeAuditVerification({ valid:true }).valid).toBe(false));
});
