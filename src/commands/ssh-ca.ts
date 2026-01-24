// Path: src/commands/ssh-ca.ts

/**
 * SSH CA command re-exports for backward compatibility.
 * The actual implementation has been modularized into src/commands/ssh-ca/
 */

export { registerSSHCACommands } from './ssh-ca/index.js';

// Re-export types for consumers
export type {
  SSHCAStatus,
  SSHCA,
  PrincipalMapping,
  ServerGroup,
  AccessRule,
  SSHCertificate,
  SignedCertificate,
} from './ssh-ca/types.js';
