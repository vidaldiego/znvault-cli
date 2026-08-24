// Path: src/lib/config/index.ts

/**
 * Config module - main entry point
 *
 * Re-exports all config functionality for backward compatibility.
 */

// Types
export type { Profile, ConfigStore, ProfileInfo, ApiKeyInfo } from './types.js';
export { CONFIG_DEFAULTS, DEFAULT_PROFILE } from './types.js';

// Store
export { store, setRuntimeProfile, resetConfig, getConfigPath, _resetStoreInstance } from './store.js';

// Migration
export { ensureMigrated, resetMigrationState } from './migration.js';

// Cache
export {
  invalidateProfileCache,
  invalidateAllProfileCaches,
  invalidateConfigCache,
  invalidateAllCaches,
  getCacheStats,
} from './cache.js';

// Profile management
export {
  getActiveProfileName,
  getCurrentProfile,
  saveProfile,
  listProfiles,
  listProfileNames,
  profileExists,
  createProfile,
  deleteProfile,
  switchProfile,
  getProfile,
  renameProfile,
} from './profile.js';

// Credentials
export {
  storeCredentials,
  clearCredentials,
  getCredentials,
  isTokenExpired,
  hasEnvCredentials,
  getEnvCredentials,
  // refresh-token-race-fix §A.1 additions:
  decodeRefreshJti,
  writePendingRefreshMarker,
  decidePendingRefresh,
  logPendingRefreshRecovery,
  type MarkerDecision,
} from './credentials.js';

// API key
export {
  hasApiKey,
  getApiKey,
  storeApiKey,
  getStoredApiKeyInfo,
  clearApiKey,
  getStoredApiKey,
} from './apikey.js';

// Plugins
export {
  getPlugins,
  addPlugin,
  removePlugin,
  setPluginEnabled,
  clearPlugins,
} from './plugins.js';

// Config getters/setters
export {
  getConfig,
  getConfigValue,
  setConfigValue,
  getEffectiveUrl,
  getAllConfig,
} from './getters.js';

// Validation
export {
  validateEnvironment,
  assertValidEnvironment,
  getValidatedEnvCredentials,
  getValidatedApiKey,
  getValidatedUrl,
  type ValidationResult,
} from './validation.js';

// Auto-unseal
export {
  storeAutoUnsealSecret,
  getAutoUnsealSecret,
  hasAutoUnsealSecret,
  clearAutoUnsealSecret,
  generateTOTPCode,
  parseOTPAuthURI,
  isSecureStorageAvailable,
} from './autounseal.js';

// Keychain (low-level, for advanced use)
export {
  isKeychainAvailable,
  keychainStore,
  keychainGet,
  keychainDelete,
} from './keychain.js';
