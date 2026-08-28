const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function positiveSafeInteger(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return value;
}

export function sha256Hex(raw: string, option: string): string {
  if (!SHA256_HEX.test(raw)) {
    throw new Error(`${option} must be a lowercase SHA-256 hex digest`);
  }
  return raw;
}

export function idempotencyUuid(raw: string): string {
  if (!UUID.test(raw)) {
    throw new Error('--idempotency-key must be a UUID');
  }
  return raw;
}
