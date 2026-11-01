/** Raw argv contains arguments only (without Node/script). Never inspect tokens
 * after --, or mistake a global option's value for the command name. All recovery
 * commands currently fail closed offline; assisted routing belongs to its adapter. */
export function selectRecoveryBootstrap(argv: readonly string[]): 'offline-recovery' | 'normal' {
  const valued = new Set(['--profile', '--url', '--tls-spki-sha256']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') return 'normal';
    if (valued.has(arg)) { index++; continue; }
    if (arg.startsWith('-')) continue;
    return arg === 'recovery' ? 'offline-recovery' : 'normal';
  }
  return 'normal';
}
