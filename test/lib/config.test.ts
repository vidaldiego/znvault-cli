import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock conf before importing config
vi.mock('conf', () => {
  const store = new Map<string, unknown>();
  return {
    default: class MockConf {
      projectName: string;
      path = '/mock/config/path';

      constructor(options: { projectName: string; defaults?: Record<string, unknown> }) {
        this.projectName = options.projectName;
      }

      get<T>(key: string): T | undefined {
        return store.get(key) as T | undefined;
      }

      set(key: string, value: unknown): void {
        store.set(key, value);
      }

      delete(key: string): void {
        store.delete(key);
      }

      clear(): void {
        store.clear();
      }
    }
  };
});

describe('config', () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.ZNVAULT_URL;
    delete process.env.ZNVAULT_API_KEY;
    delete process.env.ZNVAULT_USERNAME;
    delete process.env.ZNVAULT_PASSWORD;
    delete process.env.ZNVAULT_INSECURE;
    delete process.env.ZNVAULT_TIMEOUT;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('getConfig', () => {
    it('should return default values when nothing is set', async () => {
      const { getConfig } = await import('../../src/lib/config.js');
      const config = getConfig();

      expect(config.url).toBe('https://localhost:8443');
      expect(config.insecure).toBe(false);
      expect(config.timeout).toBe(30000);
    });

    it('should prefer environment variables over stored config', async () => {
      process.env.ZNVAULT_URL = 'https://env-vault.example.com';
      process.env.ZNVAULT_INSECURE = 'true';
      process.env.ZNVAULT_TIMEOUT = '60000';

      const { getConfig } = await import('../../src/lib/config.js');
      const config = getConfig();

      expect(config.url).toBe('https://env-vault.example.com');
      expect(config.insecure).toBe(true);
      expect(config.timeout).toBe(60000);
    });
  });

  describe('hasApiKey', () => {
    it('should return false when ZNVAULT_API_KEY is not set', async () => {
      const { hasApiKey } = await import('../../src/lib/config.js');
      expect(hasApiKey()).toBe(false);
    });

    it('should return true when ZNVAULT_API_KEY is set', async () => {
      process.env.ZNVAULT_API_KEY = 'test-api-key';
      const { hasApiKey } = await import('../../src/lib/config.js');
      expect(hasApiKey()).toBe(true);
    });
  });

  describe('hasEnvCredentials', () => {
    it('should return false when credentials are not set', async () => {
      const { hasEnvCredentials } = await import('../../src/lib/config.js');
      expect(hasEnvCredentials()).toBe(false);
    });

    it('should return false when only username is set', async () => {
      process.env.ZNVAULT_USERNAME = 'admin';
      const { hasEnvCredentials } = await import('../../src/lib/config.js');
      expect(hasEnvCredentials()).toBe(false);
    });

    it('should return true when both username and password are set', async () => {
      process.env.ZNVAULT_USERNAME = 'admin';
      process.env.ZNVAULT_PASSWORD = 'secret';
      const { hasEnvCredentials } = await import('../../src/lib/config.js');
      expect(hasEnvCredentials()).toBe(true);
    });
  });

  describe('getEnvCredentials', () => {
    it('should return undefined when credentials are not set', async () => {
      const { getEnvCredentials } = await import('../../src/lib/config.js');
      expect(getEnvCredentials()).toBeUndefined();
    });

    it('should return credentials when set', async () => {
      process.env.ZNVAULT_USERNAME = 'admin';
      process.env.ZNVAULT_PASSWORD = 'secret';
      const { getEnvCredentials } = await import('../../src/lib/config.js');
      const creds = getEnvCredentials();

      expect(creds).toEqual({
        username: 'admin',
        password: 'secret',
      });
    });
  });

  describe('isTokenExpired', () => {
    it('should return true when no credentials are stored', async () => {
      const { isTokenExpired } = await import('../../src/lib/config.js');
      expect(isTokenExpired()).toBe(true);
    });
  });
});
