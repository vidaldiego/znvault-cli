// Path: znvault-cli/src/plugins/types.ts
// CLI plugin interfaces for znvault

import type { Command } from 'commander';
import type { VaultClient } from '../lib/client.js';
import type { FullConfig } from '../types/index.js';
import * as output from '../lib/output.js';

/**
 * CLI plugin interface
 *
 * Plugins can add commands to the znvault CLI by implementing this interface.
 * Commands are registered on the commander program during CLI startup.
 */
export interface CLIPlugin {
  /** Unique plugin name (e.g., 'payara', 'kubernetes') */
  name: string;

  /** Semver version */
  version: string;

  /** Optional description */
  description?: string;

  /**
   * Register commands on the CLI program.
   * Can add top-level commands or subcommands under existing groups.
   *
   * @param program - The root Commander program
   * @param ctx - Context with access to client, output, and config
   */
  registerCommands(program: Command, ctx: CLIPluginContext): void;
}

/**
 * Factory function for creating configurable plugins
 */
export type CLIPluginFactory = (config?: Record<string, unknown>) => CLIPlugin;

/**
 * Context provided to CLI plugins - safe access to CLI internals
 */
export interface CLIPluginContext {
  /** HTTP client with authentication */
  client: VaultClient;

  /** Output utilities (respects --plain mode) */
  output: typeof output;

  /** Get current profile config */
  getConfig(): FullConfig;

  /** Get current profile name */
  getProfileName(): string;

  /** Check if plain mode is active */
  isPlainMode(): boolean;
}

/**
 * Plugin configuration stored in CLI config
 */
export interface CLIPluginConfig {
  /** npm package name (e.g., '@zincapp/znvault-plugin-payara') */
  package?: string;

  /** Local file path (alternative to package) */
  path?: string;

  /** Plugin-specific configuration passed to factory */
  config?: Record<string, unknown>;

  /** Enable/disable plugin (default: true) */
  enabled?: boolean;
}

/**
 * Internal loaded plugin state
 */
export interface LoadedCLIPlugin {
  plugin: CLIPlugin;
  config?: Record<string, unknown>;
  source: string; // package name or path
  status: 'loaded' | 'error';
  error?: Error;
}
