// Path: src/lib/config/migration.ts

/**
 * Config migration from legacy format to profile-based format
 */

import { store, withStoreMutation } from './store.js';
import { CONFIG_DEFAULTS, DEFAULT_PROFILE, type Profile } from './types.js';

/**
 * Flag to track if migration has been attempted
 */
let migrationAttempted = false;

/**
 * Ensure migration has been run (lazy initialization)
 * Wraps migrateIfNeeded with error handling to prevent module load failures
 */
export function ensureMigrated(): void {
  if (migrationAttempted) return;
  migrationAttempted = true;

  try {
    migrateIfNeeded();
  } catch (error) {
    // Log warning but don't fail module load
    console.error(
      'Warning: Config migration failed:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Migrate legacy config to profile-based config
 */
function migrateIfNeeded(): void {
  withStoreMutation(() => {
    // Check if we have legacy config (url at root level but no profiles)
    const legacyUrl = store.get('url');
    const profiles = store.get('profiles');

    if (legacyUrl && Object.keys(profiles).length === 0) {
      // Migrate legacy config to default profile
      const defaultProfile: Profile = {
        url: legacyUrl,
        insecure: store.get('insecure') ?? CONFIG_DEFAULTS.insecure,
        timeout: store.get('timeout') ?? CONFIG_DEFAULTS.timeout,
        defaultTenant: store.get('defaultTenant'),
        credentials: store.get('credentials'),
      };

      store.set('profiles', { [DEFAULT_PROFILE]: defaultProfile });
      store.set('activeProfile', DEFAULT_PROFILE);

      // Clean up legacy keys
      store.delete('url');
      store.delete('insecure');
      store.delete('timeout');
      store.delete('defaultTenant');
      store.delete('credentials');
    }
  });
}

/**
 * Reset migration state (for testing)
 */
export function resetMigrationState(): void {
  migrationAttempted = false;
}
