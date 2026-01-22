// Path: test/setup.ts
/**
 * Global test setup for vitest.
 *
 * This file runs before all tests and sets up proper isolation
 * to prevent tests from modifying the user's real configuration.
 */

import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Create a temporary directory for test config
const TEST_CONFIG_DIR = path.join(os.tmpdir(), `znvault-cli-test-${process.pid}`);

// Store for mocked Conf instances
const mockStores = new Map<string, Map<string, unknown>>();

/**
 * Get or create a mock store for a project
 */
function getStore(projectName: string): Map<string, unknown> {
  if (!mockStores.has(projectName)) {
    mockStores.set(projectName, new Map());
  }
  return mockStores.get(projectName)!;
}

/**
 * Mock implementation of Conf that uses in-memory storage
 */
class MockConf<T extends Record<string, unknown> = Record<string, unknown>> {
  private store: Map<string, unknown>;
  private defaults: Partial<T>;
  public path: string;

  constructor(options: { projectName: string; defaults?: Partial<T>; cwd?: string }) {
    this.store = getStore(options.projectName);
    this.defaults = options.defaults ?? {};
    this.path = path.join(TEST_CONFIG_DIR, options.projectName, 'config.json');

    // Initialize with defaults if store is empty
    if (this.store.size === 0 && this.defaults) {
      for (const [key, value] of Object.entries(this.defaults)) {
        this.store.set(key, value);
      }
    }
  }

  get<K extends keyof T>(key: K): T[K] | undefined;
  get<K extends keyof T>(key: K, defaultValue: T[K]): T[K];
  get(key: string, defaultValue?: unknown): unknown {
    if (this.store.has(key)) {
      return this.store.get(key);
    }
    if (key in this.defaults) {
      return (this.defaults as Record<string, unknown>)[key];
    }
    return defaultValue;
  }

  set<K extends keyof T>(key: K, value: T[K]): void;
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key) || key in this.defaults;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  get store_raw(): T {
    const result = { ...this.defaults } as Record<string, unknown>;
    for (const [key, value] of this.store.entries()) {
      result[key] = value;
    }
    return result as T;
  }
}

// Mock the conf module globally
vi.mock('conf', () => ({
  default: MockConf,
}));

beforeAll(() => {
  // Ensure test config directory exists
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });

  // Set environment variables to ensure isolation
  process.env.ZNVAULT_TEST_MODE = 'true';
});

afterEach(() => {
  // Clear all mock stores between tests to prevent state leakage
  mockStores.clear();

  // Reset any runtime state in modules
  vi.resetModules();
});

afterAll(() => {
  // Clean up test config directory
  try {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  delete process.env.ZNVAULT_TEST_MODE;
});

// Export for tests that need direct access
export { MockConf, mockStores, TEST_CONFIG_DIR };
