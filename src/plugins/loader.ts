// Path: znvault-cli/src/plugins/loader.ts
// CLI plugin loader for znvault

import type { Command } from 'commander';
import type {
  CLIPlugin,
  CLIPluginConfig,
  CLIPluginContext,
  CLIPluginFactory,
  LoadedCLIPlugin,
} from './types.js';
import type { VaultClient } from '../lib/client.js';
import type { FullConfig } from '../types/index.js';
import * as output from '../lib/output.js';
import { isPlainMode } from '../lib/output-mode.js';
import { getConfigPath } from '../lib/config.js';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

/**
 * Get the plugins directory path (alongside config.json)
 */
function getPluginsDir(): string {
  const configPath = getConfigPath();
  return join(dirname(configPath), 'plugins');
}

/**
 * CLI Plugin Loader
 *
 * Discovers and loads plugins that add commands to the znvault CLI.
 * Plugins are npm packages or local files that export a CLIPlugin.
 */
export class CLIPluginLoader {
  private plugins: Map<string, LoadedCLIPlugin> = new Map();
  private context: CLIPluginContext;

  constructor(
    client: VaultClient,
    getConfig: () => FullConfig,
    getProfileName: () => string
  ) {
    this.context = {
      client,
      output,
      getConfig,
      getProfileName,
      isPlainMode,
    };
  }

  /**
   * Load plugins from configuration
   */
  async loadPlugins(pluginConfigs: CLIPluginConfig[]): Promise<void> {
    for (const config of pluginConfigs) {
      // Skip disabled plugins
      if (config.enabled === false) {
        continue;
      }

      try {
        await this.loadPlugin(config);
      } catch (err) {
        // Don't fail CLI startup on plugin error - just warn
        const source = config.package || config.path || 'unknown';
        console.warn(`Failed to load plugin ${source}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Load a single plugin
   */
  async loadPlugin(config: CLIPluginConfig): Promise<void> {
    const { package: packageName, path: localPath, config: pluginOptions } = config;

    const source = packageName || localPath || 'unknown';

    try {
      let module: { default: CLIPlugin | CLIPluginFactory };

      if (localPath) {
        // Local plugin file - resolve to absolute path
        const absolutePath = resolve(localPath);

        if (!existsSync(absolutePath)) {
          throw new Error(`Plugin file not found: ${absolutePath}`);
        }

        // Convert to file URL for ESM import
        const fileUrl = pathToFileURL(absolutePath).href;
        module = await import(fileUrl) as { default: CLIPlugin | CLIPluginFactory };
      } else if (packageName) {
        // npm package - resolve from plugins directory
        const pluginsDir = getPluginsDir();
        const packagePath = join(pluginsDir, 'node_modules', packageName);

        if (existsSync(packagePath)) {
          // Load from plugins directory
          const pkgJsonPath = join(packagePath, 'package.json');
          if (!existsSync(pkgJsonPath)) {
            throw new Error(`Package ${packageName} found but missing package.json`);
          }

          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

          // Determine the CLI entry point
          // Try ./cli export first, then main/default export
          let entryPoint: string;
          if (pkgJson.exports?.['./cli']?.import) {
            entryPoint = pkgJson.exports['./cli'].import;
          } else if (pkgJson.exports?.['./cli']) {
            entryPoint = typeof pkgJson.exports['./cli'] === 'string'
              ? pkgJson.exports['./cli']
              : pkgJson.exports['./cli'].default || pkgJson.exports['./cli'].import;
          } else if (pkgJson.exports?.['.']?.import) {
            entryPoint = pkgJson.exports['.'].import;
          } else {
            entryPoint = pkgJson.main || 'dist/index.js';
          }

          const modulePath = join(packagePath, entryPoint);
          const fileUrl = pathToFileURL(modulePath).href;
          module = await import(fileUrl) as { default: CLIPlugin | CLIPluginFactory };
        } else {
          // Fallback to global module resolution (for globally installed plugins)
          module = await import(packageName) as { default: CLIPlugin | CLIPluginFactory };
        }
      } else {
        throw new Error('Plugin config must specify package or path');
      }

      // Support both direct export and factory function
      let plugin: CLIPlugin;
      if (typeof module.default === 'function') {
        plugin = (module.default as CLIPluginFactory)(pluginOptions);
      } else {
        plugin = module.default;
      }

      // Validate plugin interface
      this.validatePlugin(plugin, source);

      // Check for duplicate names
      if (this.plugins.has(plugin.name)) {
        throw new Error(`Plugin name '${plugin.name}' is already registered`);
      }

      // Store loaded plugin
      this.plugins.set(plugin.name, {
        plugin,
        config: pluginOptions,
        source,
        status: 'loaded',
      });

    } catch (err) {
      // Store error state for reporting
      const errorEntry: LoadedCLIPlugin = {
        plugin: { name: source, version: '0.0.0', registerCommands: () => {} },
        source,
        status: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
      this.plugins.set(source, errorEntry);
      throw err;
    }
  }

  /**
   * Validate that a plugin has required fields
   */
  private validatePlugin(plugin: CLIPlugin, source: string): void {
    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new Error(`Invalid CLI plugin from ${source}: missing or invalid 'name'`);
    }
    if (!plugin.version || typeof plugin.version !== 'string') {
      throw new Error(`Invalid CLI plugin from ${source}: missing or invalid 'version'`);
    }
    if (!plugin.registerCommands || typeof plugin.registerCommands !== 'function') {
      throw new Error(`Invalid CLI plugin from ${source}: missing or invalid 'registerCommands' function`);
    }
  }

  /**
   * Register all loaded plugin commands on the program
   */
  registerCommands(program: Command): void {
    for (const [name, loaded] of this.plugins) {
      if (loaded.status !== 'loaded') {
        continue;
      }

      try {
        loaded.plugin.registerCommands(program, this.context);
      } catch (err) {
        console.warn(
          `Failed to register commands for plugin ${name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /**
   * Get list of loaded plugins
   */
  getLoadedPlugins(): Array<{ name: string; version: string; source: string; status: string }> {
    return Array.from(this.plugins.values())
      .filter(p => p.status === 'loaded')
      .map(p => ({
        name: p.plugin.name,
        version: p.plugin.version,
        source: p.source,
        status: p.status,
      }));
  }

  /**
   * Check if any plugins are loaded
   */
  hasPlugins(): boolean {
    return Array.from(this.plugins.values()).some(p => p.status === 'loaded');
  }

  /**
   * Get plugin count
   */
  getPluginCount(): number {
    return Array.from(this.plugins.values()).filter(p => p.status === 'loaded').length;
  }

  /**
   * Get a specific plugin by name
   */
  getPlugin(name: string): LoadedCLIPlugin | undefined {
    return this.plugins.get(name);
  }
}

/**
 * Create and initialize CLI plugin loader
 *
 * @param pluginConfigs - Plugin configurations from CLI config
 * @param client - Vault HTTP client
 * @param getConfig - Function to get current profile config
 * @param getProfileName - Function to get current profile name
 * @returns Initialized plugin loader
 */
export async function createCLIPluginLoader(
  pluginConfigs: CLIPluginConfig[],
  client: VaultClient,
  getConfig: () => FullConfig,
  getProfileName: () => string
): Promise<CLIPluginLoader> {
  const loader = new CLIPluginLoader(client, getConfig, getProfileName);
  await loader.loadPlugins(pluginConfigs);
  return loader;
}
