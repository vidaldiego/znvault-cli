/**
 * Decide whether configured CLI plugins may be loaded for this invocation.
 *
 * This check intentionally runs against raw argv before Commander parses it:
 * plugin modules execute code as soon as they are imported, so consulting the
 * parsed option would be too late. Arguments after the first `--` belong to a
 * child command (notably `znvault ssh connect`) and must not affect CLI policy.
 */
export function areCLIPluginsDisabled(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const envValue = env.ZNVAULT_NO_PLUGINS?.trim().toLowerCase();
  if (envValue === '1' || envValue === 'true') {
    return true;
  }

  const separatorIndex = argv.indexOf('--');
  const cliArgv = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

  return cliArgv.some(
    argument => argument === '--no-plugins' || argument.startsWith('--no-plugins=')
  );
}
