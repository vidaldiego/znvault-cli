import { describe, it, expect } from 'vitest';
import {
  validateTokenAlias,
  validateFieldPath,
  buildLinkData,
} from '../../../src/commands/secret/references.js';

describe('references', () => {
  describe('validateTokenAlias', () => {
    it('accepts a normal path alias', () => {
      expect(validateTokenAlias('db/prod/creds')).toEqual({ valid: true });
    });
    it('accepts leading underscore and digits', () => {
      expect(validateTokenAlias('_x9/a.b-c')).toEqual({ valid: true });
    });
    it('rejects a leading dash (shell ${ref:-default} collision)', () => {
      const r = validateTokenAlias('-bad');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/start with/i);
    });
    it('rejects an empty alias', () => {
      expect(validateTokenAlias('').valid).toBe(false);
    });
    it('rejects characters outside the grammar', () => {
      expect(validateTokenAlias('has space').valid).toBe(false);
      expect(validateTokenAlias('a#b').valid).toBe(false);
    });
    it('rejects an alias longer than 512 chars', () => {
      expect(validateTokenAlias('a'.repeat(513)).valid).toBe(false);
    });
  });

  describe('validateFieldPath', () => {
    it('accepts a nested dot-path', () => {
      expect(validateFieldPath('db.host')).toEqual({ valid: true });
    });
    it('accepts a single segment', () => {
      expect(validateFieldPath('password')).toEqual({ valid: true });
    });
    it('rejects an empty segment', () => {
      expect(validateFieldPath('a..b').valid).toBe(false);
      expect(validateFieldPath('.a').valid).toBe(false);
      expect(validateFieldPath('a.').valid).toBe(false);
    });
    it('rejects an empty path', () => {
      expect(validateFieldPath('').valid).toBe(false);
    });
    it('rejects prototype-pollution segments', () => {
      expect(validateFieldPath('__proto__.x').valid).toBe(false);
      expect(validateFieldPath('a.constructor').valid).toBe(false);
      expect(validateFieldPath('prototype').valid).toBe(false);
    });
    it('rejects a path longer than 256 chars', () => {
      expect(validateFieldPath('a'.repeat(257)).valid).toBe(false);
    });
  });

  describe('buildLinkData', () => {
    it('builds a field-less pointer', () => {
      expect(buildLinkData('db/prod/creds')).toEqual({ ref: 'db/prod/creds' });
    });
    it('builds a field-narrowed pointer', () => {
      expect(buildLinkData('db/prod/creds', 'password')).toEqual({
        ref: 'db/prod/creds',
        field: 'password',
      });
    });
    it('omits an empty field', () => {
      expect(buildLinkData('db/prod/creds', '')).toEqual({ ref: 'db/prod/creds' });
    });
  });
});
