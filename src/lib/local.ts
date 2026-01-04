import fs from 'node:fs';
import path from 'node:path';

/**
 * Local mode detection and configuration.
 *
 * When running on a vault node with sudo, the CLI can bypass API authentication
 * and access the database directly. This is useful for:
 * - Emergency operations when locked out
 * - Administrative tasks without needing to configure credentials
 * - Quick health checks and diagnostics
 *
 * Requirements for local mode:
 * 1. Running on a vault node (detected by presence of /opt/znvault/current)
 * 2. Running as root or with sudo (to read service environment)
 * 3. DATABASE_URL available (from env or service config)
 */

const VAULT_INSTALL_PATH = '/opt/znvault/current';
const SERVICE_ENV_PATHS = [
  '/etc/znvault/env',
  '/opt/zn-vault/.env',        // Default systemd EnvironmentFile location
  '/opt/znvault/.env',
  '/opt/znvault/current/.env',
];
const SYSTEMD_ENV_PATH = '/etc/systemd/system/zn-vault.service.d/env.conf';

interface LocalConfig {
  databaseUrl: string;
  databaseSsl: boolean;
  nodeId?: string;
}

/**
 * Check if we're running on a vault node
 */
export function isVaultNode(): boolean {
  try {
    return fs.existsSync(VAULT_INSTALL_PATH);
  } catch {
    return false;
  }
}

/**
 * Check if running as root (required to read service environment)
 */
export function isRoot(): boolean {
  return process.getuid?.() === 0;
}

/**
 * Check if local mode is available and should be used
 */
export function isLocalModeAvailable(): boolean {
  // Already have DATABASE_URL in env
  if (process.env.DATABASE_URL) {
    return true;
  }

  // On vault node with root access
  return isVaultNode() && isRoot();
}

/**
 * Parse environment file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Handle systemd format: Environment="KEY=VALUE"
    const systemdMatch = trimmed.match(/^Environment="?([^"=]+)=(.+?)"?$/);
    if (systemdMatch) {
      env[systemdMatch[1]] = systemdMatch[2].replace(/^["']|["']$/g, '');
      continue;
    }

    // Handle standard format: KEY=VALUE or export KEY=VALUE
    const match = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (match) {
      let value = match[2];
      // Remove surrounding quotes
      value = value.replace(/^["']|["']$/g, '');
      env[match[1]] = value;
    }
  }

  return env;
}

/**
 * Read environment from service configuration files
 */
function readServiceEnv(): Record<string, string> {
  const combined: Record<string, string> = {};

  // Try each possible env file location
  for (const envPath of SERVICE_ENV_PATHS) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        Object.assign(combined, parseEnvFile(content));
      }
    } catch {
      // Skip files we can't read
    }
  }

  // Also try systemd environment override
  try {
    if (fs.existsSync(SYSTEMD_ENV_PATH)) {
      const content = fs.readFileSync(SYSTEMD_ENV_PATH, 'utf-8');
      Object.assign(combined, parseEnvFile(content));
    }
  } catch {
    // Skip if can't read
  }

  return combined;
}

/**
 * Get local mode configuration
 * Returns null if local mode is not available or properly configured
 */
export function getLocalConfig(): LocalConfig | null {
  // First check if DATABASE_URL is already in environment
  if (process.env.DATABASE_URL) {
    return {
      databaseUrl: process.env.DATABASE_URL,
      databaseSsl: process.env.DATABASE_SSL === 'true',
      nodeId: process.env.HA_NODE_ID,
    };
  }

  // Not on a vault node
  if (!isVaultNode()) {
    return null;
  }

  // Need root to read service env
  if (!isRoot()) {
    return null;
  }

  // Read service environment
  const serviceEnv = readServiceEnv();

  // Inject service env vars into process.env for use by db.ts
  if (serviceEnv.HA_ENABLED) process.env.HA_ENABLED = serviceEnv.HA_ENABLED;
  if (serviceEnv.HA_NODE_ID) process.env.HA_NODE_ID = serviceEnv.HA_NODE_ID;
  if (serviceEnv.REDIS_URL) process.env.REDIS_URL = serviceEnv.REDIS_URL;
  if (serviceEnv.REDIS_SENTINEL_NODES) process.env.REDIS_SENTINEL_NODES = serviceEnv.REDIS_SENTINEL_NODES;
  if (serviceEnv.REDIS_SENTINEL_MASTER) process.env.REDIS_SENTINEL_MASTER = serviceEnv.REDIS_SENTINEL_MASTER;

  // Check for DATABASE_URL
  const databaseUrl = serviceEnv.DATABASE_URL;
  if (!databaseUrl) {
    // Try to construct from individual DB_* variables
    const host = serviceEnv.DB_HOST || serviceEnv.POSTGRES_HOST;
    const port = serviceEnv.DB_PORT || serviceEnv.POSTGRES_PORT || '5432';
    const database = serviceEnv.DB_NAME || serviceEnv.POSTGRES_DB || 'znvault';
    const user = serviceEnv.DB_USER || serviceEnv.POSTGRES_USER;
    const password = serviceEnv.DB_PASSWORD || serviceEnv.POSTGRES_PASSWORD;

    if (host && user && password) {
      return {
        databaseUrl: `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
        databaseSsl: serviceEnv.DATABASE_SSL === 'true' || serviceEnv.DB_SSL === 'true',
        nodeId: serviceEnv.HA_NODE_ID,
      };
    }

    return null;
  }

  return {
    databaseUrl,
    databaseSsl: serviceEnv.DATABASE_SSL === 'true',
    nodeId: serviceEnv.HA_NODE_ID,
  };
}

/**
 * Get the current vault version from VERSION file
 */
export function getLocalVaultVersion(): string | null {
  try {
    const versionPath = path.join(VAULT_INSTALL_PATH, 'VERSION');
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, 'utf-8').trim();
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Check if the vault service is running
 */
export function isVaultServiceRunning(): boolean {
  try {
    // Check if process is listening on expected port
    const { execSync } = require('node:child_process');
    const result = execSync('systemctl is-active zn-vault 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.trim() === 'active';
  } catch {
    return false;
  }
}

/**
 * Get a description of local mode status for display
 */
export function getLocalModeStatus(): {
  available: boolean;
  reason?: string;
  nodeId?: string;
  vaultVersion?: string;
} {
  if (process.env.DATABASE_URL) {
    return {
      available: true,
      reason: 'DATABASE_URL environment variable set',
      nodeId: process.env.HA_NODE_ID,
    };
  }

  if (!isVaultNode()) {
    return {
      available: false,
      reason: 'Not running on a vault node (missing /opt/znvault/current)',
    };
  }

  if (!isRoot()) {
    return {
      available: false,
      reason: 'Local mode requires root access. Try: sudo znvault <command>',
    };
  }

  const config = getLocalConfig();
  if (!config) {
    return {
      available: false,
      reason: 'Could not find DATABASE_URL in service configuration',
    };
  }

  return {
    available: true,
    reason: 'Running on vault node with root access',
    nodeId: config.nodeId,
    vaultVersion: getLocalVaultVersion() || undefined,
  };
}
