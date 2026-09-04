export function interactiveSecretValuePromptType(
  protection: string | undefined,
  standardType: 'input' | 'editor',
): 'input' | 'editor' | 'password' {
  return protection === 'user-session' || protection === 'USER_SESSION_ONLY'
    ? 'password'
    : standardType;
}

export function supportsArgvPatch(protection: string | undefined): boolean {
  return protection !== 'user-session' && protection !== 'USER_SESSION_ONLY';
}
