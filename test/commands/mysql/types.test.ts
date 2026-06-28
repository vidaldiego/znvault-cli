import { describe, it, expect } from 'vitest';
import type { GeneratedCredential } from '../../../src/commands/dynamic-secrets/types.js';

describe('GeneratedCredential host fields', () => {
  it('accepts host/port/database', () => {
    const c: GeneratedCredential = {
      leaseId: 'l',
      username: 'u',
      password: 'p',
      expiresAt: 'x',
      maxExpiresAt: 'y',
      ttlSeconds: 600,
      renewalCount: 0,
      host: '10.0.0.5',
      port: 3306,
      database: 'appdb',
    };
    expect(c.host).toBe('10.0.0.5');
  });
});
