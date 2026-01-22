// Path: src/commands/secret.ts

/**
 * Secret commands - backward compatibility re-export
 *
 * This file maintains backward compatibility by re-exporting from the
 * modularized secret/ directory structure.
 */

export { registerSecretCommands } from './secret/index.js';
export * from './secret/types.js';
