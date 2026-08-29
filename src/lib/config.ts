// Path: src/lib/config.ts

/**
 * Config module - backward compatibility re-export
 *
 * This file maintains backward compatibility by re-exporting from the
 * modularized config/ directory structure.
 */

export {
  // Types
  type Profile,
  type ConfigStore,
  type ProfileInfo,
  type ApiKeyInfo,
  CONFIG_DEFAULTS,
  DEFAULT_PROFILE,

  // Store
  store,
  setRuntimeProfile,
  resetConfig,
  getConfigPath,

  // Migration
  ensureMigrated,
  resetMigrationState,

  // Cache
  invalidateProfileCache,
  invalidateAllProfileCaches,
  invalidateConfigCache,
  invalidateAllCaches,
  getCacheStats,

  // Profile management
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
  mutateProfileAuthentication,

  // Credentials
  storeCredentials,
  clearCredentials,
  getCredentials,
  isTokenExpired,
  hasEnvCredentials,
  getEnvCredentials,
  decodeRefreshJti,
  writePendingRefreshMarker,
  decidePendingRefresh,
  logPendingRefreshRecovery,
  type MarkerDecision,

  // API key
  hasApiKey,
  getApiKey,
  storeApiKey,
  getStoredApiKeyInfo,
  clearApiKey,
  getStoredApiKey,

  // Plugins
  getPlugins,
  addPlugin,
  removePlugin,
  setPluginEnabled,
  clearPlugins,

  // Config getters/setters
  getConfig,
  getConfigValue,
  setConfigValue,
  getEffectiveUrl,
  getAllConfig,

  // Validation
  validateEnvironment,
  assertValidEnvironment,
  getValidatedEnvCredentials,
  getValidatedApiKey,
  getValidatedUrl,
  type ValidationResult,

  // Auto-unseal
  storeAutoUnsealSecret,
  getAutoUnsealSecret,
  hasAutoUnsealSecret,
  clearAutoUnsealSecret,
  generateTOTPCode,
  parseOTPAuthURI,
} from './config/index.js';
