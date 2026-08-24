// Path: znvault-cli/test/commands/secret/raw-value.test.ts

import { describe, it, expect } from 'vitest';
import { selectRawValue, RawSelectionError } from '../../../src/commands/secret/raw-value.js';

describe('selectRawValue', () => {
  describe('without --field', () => {
    it('returns the single value of a one-key payload (plain text secret)', () => {
      expect(selectRawValue({ text: 'sk-123' })).toEqual({ kind: 'text', value: 'sk-123' });
    });

    it('returns the single value of a resolved-link { value } envelope', () => {
      expect(selectRawValue({ value: 'p@ss' })).toEqual({ kind: 'text', value: 'p@ss' });
    });

    it('decodes a file-based secret to bytes', () => {
      const content = Buffer.from('-----BEGIN KEY-----\n').toString('base64');
      const out = selectRawValue({ filename: 'key.pem', content, contentType: 'application/x-pem-file' });
      expect(out.kind).toBe('bytes');
      expect((out.value as Buffer).toString()).toBe('-----BEGIN KEY-----\n');
    });

    it('rejects a multi-field payload and lists the fields', () => {
      expect(() => selectRawValue({ username: 'u', password: 'p' })).toThrow(RawSelectionError);
      expect(() => selectRawValue({ username: 'u', password: 'p' })).toThrow(/--field/);
      expect(() => selectRawValue({ username: 'u', password: 'p' })).toThrow(/username, password/);
    });

    it('rejects an empty payload', () => {
      expect(() => selectRawValue({})).toThrow(RawSelectionError);
    });

    it('rejects a missing payload', () => {
      expect(() => selectRawValue(undefined)).toThrow(RawSelectionError);
    });
  });

  describe('with --field', () => {
    it('returns a string field verbatim', () => {
      expect(selectRawValue({ username: 'u', password: 'p@ss' }, 'password')).toEqual({
        kind: 'text',
        value: 'p@ss',
      });
    });

    it('renders a non-string scalar as compact JSON', () => {
      expect(selectRawValue({ port: 5432 }, 'port')).toEqual({ kind: 'text', value: '5432' });
      expect(selectRawValue({ on: true }, 'on')).toEqual({ kind: 'text', value: 'true' });
    });

    it('renders an object field as compact single-line JSON', () => {
      expect(selectRawValue({ db: { host: 'h', port: 1 } }, 'db')).toEqual({
        kind: 'text',
        value: '{"host":"h","port":1}',
      });
    });

    it('decodes a file-shaped field (keypair privateKey) to bytes', () => {
      const content = Buffer.from('PRIVATE').toString('base64');
      const out = selectRawValue(
        { privateKey: { filename: 'id', content }, publicKey: { filename: 'id.pub', content } },
        'privateKey',
      );
      expect(out.kind).toBe('bytes');
      expect((out.value as Buffer).toString()).toBe('PRIVATE');
    });

    it('rejects an unknown field and lists the available ones', () => {
      expect(() => selectRawValue({ username: 'u', password: 'p' }, 'token')).toThrow(RawSelectionError);
      expect(() => selectRawValue({ username: 'u', password: 'p' }, 'token')).toThrow(/'token'/);
      expect(() => selectRawValue({ username: 'u', password: 'p' }, 'token')).toThrow(/username, password/);
    });

    it('does not resolve prototype properties as fields', () => {
      expect(() => selectRawValue({ a: 1 }, 'toString')).toThrow(RawSelectionError);
    });
  });
});
