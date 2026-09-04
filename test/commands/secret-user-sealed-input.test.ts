import {describe, expect, it} from 'vitest';
import {interactiveSecretValuePromptType, supportsArgvPatch} from '../../src/commands/secret/input-policy.js';

describe('User-Sealed interactive input', () => {
  it('never selects the tempfile-backed editor or a visible value prompt', () => {
    expect(interactiveSecretValuePromptType('user-session', 'editor')).toBe('password');
    expect(interactiveSecretValuePromptType('USER_SESSION_ONLY', 'editor')).toBe('password');
    expect(interactiveSecretValuePromptType('user-session', 'input')).toBe('password');
  });

  it('preserves the standard-secret prompt behavior', () => {
    expect(interactiveSecretValuePromptType('standard', 'editor')).toBe('editor');
    expect(interactiveSecretValuePromptType('standard', 'input')).toBe('input');
  });

  it('blocks argv patching for User-Sealed Secrets', () => {
    expect(supportsArgvPatch('USER_SESSION_ONLY')).toBe(false);
    expect(supportsArgvPatch('user-session')).toBe(false);
    expect(supportsArgvPatch('STANDARD')).toBe(true);
  });
});
