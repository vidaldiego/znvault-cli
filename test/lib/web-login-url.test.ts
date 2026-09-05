import { describe, expect, it } from 'vitest';
import { buildCliAuthUrl } from '../../src/lib/web-login.js';

describe('CLI browser-login URL', () => {
  it('uses the canonical trailing-slash route and current CLI version', () => {
    const url = buildCliAuthUrl(
      'https://vault.example.test/',
      'http://127.0.0.1:43210/callback',
      { state: 'state-value', codeChallenge: 'challenge-value' },
    );

    expect(url.pathname).toBe('/cli-auth/');
    expect(url.searchParams.get('callback_uri')).toBe('http://127.0.0.1:43210/callback');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('cli_version')).toBe('5.1.1');
  });
});
