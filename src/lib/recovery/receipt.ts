import type { ExpectedSelection } from '../../vendor/archon-recovery-core/index.js';
export interface ObservedCiphertext { role: 'dump' | 'companion'; storageKey: string; versionId: string | null; bytes: number; sha256: string; previouslyPinned: boolean }
export interface RecoveryResult {
  authenticated: true; mode: 'verify' | 'extract';
  selection: Pick<ExpectedSelection, 'sourceNamespace' | 'installationUuid' | 'serviceName' | 'backupId'>;
  metadataSha256: string; ciphertext: ObservedCiphertext[]; output: string | null;
}
