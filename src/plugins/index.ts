// Path: znvault-cli/src/plugins/index.ts
// Public exports for CLI plugin system

// Types
export type {
  CLIPlugin,
  CLIPluginFactory,
  CLIPluginContext,
  CLIPluginConfig,
  LoadedCLIPlugin,
} from './types.js';

// Loader
export { CLIPluginLoader, createCLIPluginLoader } from './loader.js';
