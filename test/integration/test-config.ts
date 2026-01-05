// Path: znvault-cli/test/integration/test-config.ts

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test configuration for CLI integration tests.
 *
 * These tests run the actual CLI binary against a real ZN-Vault server.
 * When run via `npm test`, the SDK test environment is automatically started.
 *
 * Environment variables (set automatically by sdk-test-run.sh):
 * - ZNVAULT_BASE_URL: Server URL (https://localhost:9443)
 * - ZNVAULT_USERNAME: Superadmin username
 * - ZNVAULT_PASSWORD: Superadmin password
 * - ZNVAULT_TENANT: Test tenant (sdk-test)
 * - ZNVAULT_TENANT_ADMIN_USERNAME: Tenant admin username
 * - ZNVAULT_TENANT_ADMIN_PASSWORD: Tenant admin password
 *
 * Usage:
 *   npm test              # Full test with Docker (starts vault, runs tests, cleans up)
 *   npm run test:unit     # Unit tests only (mocked, fast)
 *   npm run test:integration  # Integration tests only (requires running vault)
 */

// Standard password for all test users (matches sdk-test-init.js)
const STANDARD_PASSWORD = 'SdkTest123456#';

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
}

export const TestConfig = {
  // Test server - defaults to SDK test environment (port 9443)
  BASE_URL: process.env.ZNVAULT_BASE_URL ?? 'https://localhost:9443',

  // Default tenant for tests
  DEFAULT_TENANT: process.env.ZNVAULT_TENANT ?? 'sdk-test',

  // Test users - read from environment (set by sdk-test-run.sh)
  Users: {
    SUPERADMIN_USERNAME: process.env.ZNVAULT_USERNAME ?? 'admin',
    SUPERADMIN_PASSWORD: process.env.ZNVAULT_PASSWORD ?? 'Admin123456#',

    get TENANT_ADMIN_USERNAME(): string {
      return process.env.ZNVAULT_TENANT_ADMIN_USERNAME ?? `${TestConfig.DEFAULT_TENANT}/sdk-admin`;
    },
    get TENANT_ADMIN_PASSWORD(): string {
      return process.env.ZNVAULT_TENANT_ADMIN_PASSWORD ?? STANDARD_PASSWORD;
    },

    get READER_USERNAME(): string {
      return process.env.ZNVAULT_READER_USERNAME ?? `${TestConfig.DEFAULT_TENANT}/sdk-reader`;
    },
    get READER_PASSWORD(): string {
      return process.env.ZNVAULT_READER_PASSWORD ?? STANDARD_PASSWORD;
    },

    get WRITER_USERNAME(): string {
      return process.env.ZNVAULT_WRITER_USERNAME ?? `${TestConfig.DEFAULT_TENANT}/sdk-writer`;
    },
    get WRITER_PASSWORD(): string {
      return process.env.ZNVAULT_WRITER_PASSWORD ?? STANDARD_PASSWORD;
    },
  },

  // API Keys (set by sdk-test-run.sh from sdk-test-init.js)
  ApiKeys: {
    FULL_ACCESS: process.env.ZNVAULT_API_KEY_FULL,
    READ_ONLY: process.env.ZNVAULT_API_KEY_READONLY,
    KMS_ONLY: process.env.ZNVAULT_API_KEY_KMS,
  },

  // Path to the CLI binary
  get CLI_PATH(): string {
    return path.resolve(__dirname, '../../dist/index.js');
  },

  /**
   * Execute a CLI command and return the result.
   */
  exec(...args: string[]): CLIResult {
    // Always add --url and --insecure for test environment
    const fullArgs = [
      this.CLI_PATH,
      '--url', this.BASE_URL,
      '--insecure',
      ...args,
    ];

    // Use a consistent home directory for all test commands so credentials persist
    const testHome = process.env.TEST_HOME || '/tmp/znvault-cli-test';

    const result: SpawnSyncReturns<Buffer> = spawnSync('node', fullArgs, {
      encoding: 'buffer',
      timeout: 30000,
      env: {
        ...process.env,
        // Disable interactive prompts
        CI: 'true',
        // Override any stored profile settings with test vault URL
        ZNVAULT_URL: this.BASE_URL,
        // Clear any API key from env to force JWT authentication
        ZNVAULT_API_KEY: '',
        // DO NOT set ZNVAULT_USERNAME/PASSWORD - use stored credentials from login
        ZNVAULT_USERNAME: '',
        ZNVAULT_PASSWORD: '',
        // Use isolated config directory to avoid profile conflicts
        HOME: testHome,
        // Ensure XDG dirs also use test home
        XDG_CONFIG_HOME: `${testHome}/.config`,
        XDG_DATA_HOME: `${testHome}/.local/share`,
      },
    });

    return {
      stdout: result.stdout?.toString('utf-8') ?? '',
      stderr: result.stderr?.toString('utf-8') ?? '',
      exitCode: result.status,
      success: result.status === 0,
    };
  },

  /**
   * Execute a CLI command with JSON output.
   */
  execJson<T = unknown>(...args: string[]): { data: T | null; error: string | null; success: boolean } {
    const result = this.exec(...args, '--json');

    if (!result.success) {
      return {
        data: null,
        error: result.stderr || result.stdout,
        success: false,
      };
    }

    try {
      // Find JSON in output (may have other text before/after)
      // Match JSON object starting at beginning of a line (avoids matching [profile: ...])
      const jsonObjMatch = result.stdout.match(/^\{[\s\S]*\}$/m);
      // Match JSON array starting at beginning of a line
      const jsonArrMatch = result.stdout.match(/^\[[\s\S]*\]$/m);

      const jsonMatch = jsonObjMatch || jsonArrMatch;
      if (jsonMatch) {
        return {
          data: JSON.parse(jsonMatch[0]) as T,
          error: null,
          success: true,
        };
      }
      return {
        data: null,
        error: 'No JSON found in output',
        success: false,
      };
    } catch (e) {
      return {
        data: null,
        error: `Failed to parse JSON: ${(e as Error).message}`,
        success: false,
      };
    }
  },

  /**
   * Login as superadmin and return the result.
   * Note: This stores credentials in the CLI config for subsequent commands.
   */
  loginAsSuperadmin(): CLIResult {
    // Logout first to clear any stale API keys or credentials
    this.exec('logout');
    return this.exec(
      'login',
      '-u', this.Users.SUPERADMIN_USERNAME,
      '-p', this.Users.SUPERADMIN_PASSWORD
    );
  },

  /**
   * Login as tenant admin.
   */
  loginAsTenantAdmin(): CLIResult {
    // Logout first to clear any stale API keys or credentials
    this.exec('logout');
    return this.exec(
      'login',
      '-u', this.Users.TENANT_ADMIN_USERNAME,
      '-p', this.Users.TENANT_ADMIN_PASSWORD
    );
  },

  /**
   * Check if the test vault is available.
   */
  isVaultAvailable(): boolean {
    const result = this.exec('health');
    // Check for success and "OK" status (case-insensitive)
    return result.success && result.stdout.toLowerCase().includes('ok');
  },

  /**
   * Generate a unique ID for testing.
   */
  uniqueId(prefix: string = 'test'): string {
    const uuid = crypto.randomUUID().slice(0, 8);
    return `${prefix}-${uuid}`;
  },

  /**
   * Generate a unique alias for testing.
   */
  uniqueAlias(prefix: string = 'test'): string {
    const uuid = crypto.randomUUID().slice(0, 8);
    return `${prefix}/cli-test/${uuid}`;
  },

  /**
   * Check if integration tests should run.
   */
  isIntegrationEnabled(): boolean {
    return process.env.ZNVAULT_INTEGRATION === 'true' || process.env.ZNVAULT_BASE_URL !== undefined;
  },
};
