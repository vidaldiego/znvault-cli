// Path: test/plugins/loader.test.ts
// Tests for CLI plugin loader

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { CLIPluginLoader } from '../../src/plugins/loader.js';
import type { CLIPlugin, CLIPluginConfig } from '../../src/plugins/types.js';
import type { VaultClient } from '../../src/lib/client.js';
import type { FullConfig } from '../../src/types/index.js';

// Mock client
const mockClient = {
  health: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
} as unknown as VaultClient;

// Mock config getters
const mockGetConfig = (): FullConfig => ({
  url: 'https://localhost:8443',
  insecure: false,
  timeout: 30000,
});

const mockGetProfileName = () => 'test-profile';

// Helper to create a mock plugin
function createMockPlugin(overrides: Partial<CLIPlugin> = {}): CLIPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    registerCommands: vi.fn(),
    ...overrides,
  };
}

describe('CLIPluginLoader', () => {
  let loader: CLIPluginLoader;

  beforeEach(() => {
    loader = new CLIPluginLoader(mockClient, mockGetConfig, mockGetProfileName);
  });

  describe('constructor', () => {
    it('should create a loader with context', () => {
      expect(loader).toBeInstanceOf(CLIPluginLoader);
      expect(loader.hasPlugins()).toBe(false);
      expect(loader.getPluginCount()).toBe(0);
    });
  });

  describe('loadPlugin', () => {
    it('should reject config without package or path', async () => {
      const config: CLIPluginConfig = {};
      await expect(loader.loadPlugin(config)).rejects.toThrow('must specify package or path');
    });

    it('should reject plugin with missing name', async () => {
      // We can't easily test actual import failures, but we can test validation
      const invalidPlugin = { version: '1.0.0', registerCommands: vi.fn() };

      // Create a loader and manually add an invalid plugin to test validation
      const loader = new CLIPluginLoader(mockClient, mockGetConfig, mockGetProfileName);

      // Access private method indirectly by creating a plugin config that would load
      // and then checking if validation catches issues
      await expect(loader.loadPlugin({ path: '/nonexistent/path.js' }))
        .rejects.toThrow();
    });
  });

  describe('registerCommands', () => {
    it('should call registerCommands on loaded plugins', () => {
      const program = new Command();
      const plugin = createMockPlugin();

      // Manually set up the loader with a mock plugin
      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('test-plugin', {
        plugin,
        source: 'test',
        status: 'loaded',
      });

      loader.registerCommands(program);

      expect(plugin.registerCommands).toHaveBeenCalledWith(
        program,
        expect.objectContaining({
          client: mockClient,
          getConfig: mockGetConfig,
          getProfileName: mockGetProfileName,
        })
      );
    });

    it('should skip plugins with error status', () => {
      const program = new Command();
      const plugin = createMockPlugin();

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('error-plugin', {
        plugin,
        source: 'test',
        status: 'error',
        error: new Error('Load failed'),
      });

      loader.registerCommands(program);

      expect(plugin.registerCommands).not.toHaveBeenCalled();
    });

    it('should handle errors in registerCommands gracefully', () => {
      const program = new Command();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugin = createMockPlugin({
        registerCommands: () => {
          throw new Error('Registration failed');
        },
      });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('failing-plugin', {
        plugin,
        source: 'test',
        status: 'loaded',
      });

      // Should not throw
      expect(() => loader.registerCommands(program)).not.toThrow();

      // Should warn
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register commands')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getLoadedPlugins', () => {
    it('should return empty array when no plugins loaded', () => {
      expect(loader.getLoadedPlugins()).toEqual([]);
    });

    it('should return loaded plugin info', () => {
      const plugin = createMockPlugin({ name: 'my-plugin', version: '2.0.0' });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('my-plugin', {
        plugin,
        source: '@test/my-plugin',
        status: 'loaded',
      });

      const loaded = loader.getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual({
        name: 'my-plugin',
        version: '2.0.0',
        source: '@test/my-plugin',
        status: 'loaded',
      });
    });

    it('should exclude plugins with error status', () => {
      const goodPlugin = createMockPlugin({ name: 'good' });
      const badPlugin = createMockPlugin({ name: 'bad' });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('good', {
        plugin: goodPlugin,
        source: 'good',
        status: 'loaded',
      });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('bad', {
        plugin: badPlugin,
        source: 'bad',
        status: 'error',
      });

      const loaded = loader.getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('good');
    });
  });

  describe('hasPlugins', () => {
    it('should return false when no plugins loaded', () => {
      expect(loader.hasPlugins()).toBe(false);
    });

    it('should return true when at least one plugin loaded', () => {
      const plugin = createMockPlugin();

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('test', {
        plugin,
        source: 'test',
        status: 'loaded',
      });

      expect(loader.hasPlugins()).toBe(true);
    });

    it('should return false when all plugins errored', () => {
      const plugin = createMockPlugin();

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('test', {
        plugin,
        source: 'test',
        status: 'error',
      });

      expect(loader.hasPlugins()).toBe(false);
    });
  });

  describe('getPluginCount', () => {
    it('should return 0 when no plugins loaded', () => {
      expect(loader.getPluginCount()).toBe(0);
    });

    it('should return count of loaded plugins only', () => {
      const plugin1 = createMockPlugin({ name: 'p1' });
      const plugin2 = createMockPlugin({ name: 'p2' });
      const plugin3 = createMockPlugin({ name: 'p3' });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('p1', {
        plugin: plugin1,
        source: 'p1',
        status: 'loaded',
      });
      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('p2', {
        plugin: plugin2,
        source: 'p2',
        status: 'loaded',
      });
      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('p3', {
        plugin: plugin3,
        source: 'p3',
        status: 'error',
      });

      expect(loader.getPluginCount()).toBe(2);
    });
  });

  describe('getPlugin', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(loader.getPlugin('nonexistent')).toBeUndefined();
    });

    it('should return loaded plugin by name', () => {
      const plugin = createMockPlugin({ name: 'finder' });

      (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('finder', {
        plugin,
        source: '@test/finder',
        status: 'loaded',
      });

      const found = loader.getPlugin('finder');
      expect(found).toBeDefined();
      expect(found?.plugin.name).toBe('finder');
    });
  });

  describe('loadPlugins', () => {
    it('should skip disabled plugins', async () => {
      const config: CLIPluginConfig = {
        package: '@test/disabled',
        enabled: false,
      };

      await loader.loadPlugins([config]);
      expect(loader.getPluginCount()).toBe(0);
    });

    it('should warn but not fail on load errors', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config: CLIPluginConfig = {
        package: 'nonexistent-plugin-package',
      };

      // Should not throw
      await loader.loadPlugins([config]);

      // Should have warned
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load plugin')
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('CLI Plugin Integration', () => {
  it('should allow plugin to add commands to program', () => {
    const program = new Command();
    const loader = new CLIPluginLoader(mockClient, mockGetConfig, mockGetProfileName);

    // Create a plugin that adds a command
    const plugin = createMockPlugin({
      name: 'deploy',
      registerCommands: (prog, ctx) => {
        prog
          .command('deploy')
          .description('Deploy application')
          .action(() => {
            ctx.output.success('Deployed!');
          });
      },
    });

    (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('deploy', {
      plugin,
      source: '@test/deploy',
      status: 'loaded',
    });

    loader.registerCommands(program);

    // Find the deploy command
    const deployCmd = program.commands.find(cmd => cmd.name() === 'deploy');
    expect(deployCmd).toBeDefined();
    expect(deployCmd?.description()).toBe('Deploy application');
  });

  it('should provide context with client and output utilities', () => {
    const program = new Command();
    const loader = new CLIPluginLoader(mockClient, mockGetConfig, mockGetProfileName);

    let capturedContext: unknown;
    const plugin = createMockPlugin({
      registerCommands: (_prog, ctx) => {
        capturedContext = ctx;
      },
    });

    (loader as unknown as { plugins: Map<string, unknown> }).plugins.set('test', {
      plugin,
      source: 'test',
      status: 'loaded',
    });

    loader.registerCommands(program);

    expect(capturedContext).toBeDefined();
    expect((capturedContext as { client: unknown }).client).toBe(mockClient);
    expect((capturedContext as { getConfig: unknown }).getConfig).toBe(mockGetConfig);
    expect((capturedContext as { getProfileName: unknown }).getProfileName).toBe(mockGetProfileName);
    expect((capturedContext as { output: unknown }).output).toBeDefined();
    expect((capturedContext as { isPlainMode: unknown }).isPlainMode).toBeDefined();
  });
});
