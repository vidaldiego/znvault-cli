// Path: src/commands/plugin/types.ts

/**
 * Plugin command types and constants
 */

// ZincApp plugin namespace
export const ZINCAPP_PREFIX = '@zincapp/znvault-plugin-';

// Command option interfaces
export interface PluginInstallOptions {
  force?: boolean;
  global?: boolean;
  json?: boolean;
}

export interface PluginUninstallOptions {
  json?: boolean;
}

export interface PluginUpdateOptions {
  json?: boolean;
}

export interface PluginEnableDisableOptions {
  json?: boolean;
}

export interface PluginInfoOptions {
  json?: boolean;
}

export interface PluginListOptions {
  json?: boolean;
}

// Plugin info types
export interface NpmPackageInfo {
  version: string;
  description?: string;
  homepage?: string;
  author?: string;
}

export interface PluginUpdate {
  name: string;
  packageName: string;
  from: string;
  to: string;
}
