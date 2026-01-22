// Path: src/commands/agent.ts

/**
 * Agent commands - re-export from modular structure
 *
 * This file provides backwards compatibility for imports from the old
 * monolithic agent.ts file. The actual implementation has been split
 * into the agent/ directory.
 */

export { registerAgentCommands } from './agent/index.js';
export * from './agent/types.js';
