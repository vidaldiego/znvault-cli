/** A scoped check, never proof of historical completeness. */
export interface AuditVerificationEvidence {
  status?: 'verified' | 'invalid' | 'unverifiable' | 'error' | 'empty';
  valid: boolean;
  reason?: string;
  reasons?: string[];
  errors?: string[];
  checkedEntries?: number;
  readEntries?: number;
  authenticatedEntries?: number;
  unverifiedEntries?: number;
  unsignedDetailsEntries?: number;
  scope?: 'retained' | 'tail' | 'interval';
  interval?: { firstId: number | null; lastId: number | null };
  completed?: boolean;
  startedAt?: string;
  finishedAt?: string;
  consistency?: string;
  historicalCompleteness?: string;
  brokenAt?: number;
}
/** Unknown/legacy payloads cannot certify integrity. Preserve all evidence. */
export function normalizeAuditVerification<T extends AuditVerificationEvidence>(result: T): T {
  // The response is untrusted JSON: require literal booleans at runtime.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  return { ...result, valid: result.valid === true && result.status === 'verified' && result.scope === 'retained' && result.completed === true && (result.readEntries ?? 0) > 0 && result.authenticatedEntries === result.readEntries && result.unverifiedEntries === 0 && result.unsignedDetailsEntries === 0 };
}
