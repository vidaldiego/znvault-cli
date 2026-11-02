/** Pure local diagnostics: safe to import before any connected initialization.
 * Remote bodies/plain Error.message values cannot acquire this error identity. */
export type RecoveryPrerequisiteCode = 'recovery_profile_unknown' | 'recovery_native_login_required' | 'recovery_verified_tls_required';
export class RecoveryPrerequisiteError extends Error {
  constructor(readonly code: RecoveryPrerequisiteCode) {
    super(code);
    this.name = 'RecoveryPrerequisiteError';
  }
}
/** Closed fixed messages. Never interpolate profile names, URLs or exception text. */
export function recoveryPrerequisiteMessage(error: unknown): string | undefined {
  if (!(error instanceof RecoveryPrerequisiteError)) return undefined;
  switch (error.code) {
    case 'recovery_profile_unknown':
      return 'Recovery prerequisite: the selected profile is not configured. Check the explicit --profile name, then explicitly retry recovery.';
    case 'recovery_native_login_required':
      return 'Recovery prerequisite: native login is required for the selected profile. Run znvault --profile PROFILE_NAME login using that same profile, then explicitly retry recovery.';
    case 'recovery_verified_tls_required':
      return 'Recovery prerequisite: the selected profile requires a valid HTTPS origin and verified TLS. Correct its HTTPS/TLS prerequisites, then explicitly retry recovery. Insecure TLS is not permitted.';
  }
}
