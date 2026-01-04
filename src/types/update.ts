// Path: znvault-cli/src/types/update.ts

/**
 * Agent Auto-Update Types
 *
 * Defines interfaces for the auto-update system including
 * manifests, artifacts, configuration, and progress tracking.
 */

/**
 * Channel for update releases
 */
export type UpdateChannel = 'stable' | 'beta' | 'staging';

/**
 * Platform identifiers for agent binaries
 */
export type Platform = 'linux_amd64' | 'linux_arm64';

/**
 * Information about a specific artifact (platform binary)
 */
export interface ArtifactInfo {
  /** Full URL to download the tarball */
  url: string;
  /** SHA256 checksum of the tarball */
  sha256: string;
  /** File size in bytes */
  size: number;
  /** Base64-encoded GPG signature */
  signature: string;
}

/**
 * Release manifest stored in S3
 */
export interface AgentManifest {
  /** Channel this manifest belongs to */
  channel: UpdateChannel;
  /** Semantic version (e.g., "1.0.0") */
  version: string;
  /** ISO timestamp of release */
  releaseDate: string;
  /** Minimum version required to update (for breaking changes) */
  minVersion?: string;
  /** Release notes / changelog */
  releaseNotes?: string;
  /** Platform-specific artifacts */
  artifacts: {
    linux_amd64: ArtifactInfo;
    linux_arm64: ArtifactInfo;
  };
  /** Signature metadata */
  signature: {
    /** GPG key ID used for signing */
    keyId: string;
    /** Timestamp when signed */
    signedAt: string;
  };
}

/**
 * Result of checking for updates
 */
export interface UpdateCheckResult {
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Currently installed version */
  currentVersion: string;
  /** Latest available version */
  latestVersion: string;
  /** Full manifest if update available */
  manifest?: AgentManifest;
  /** Artifact for current platform if update available */
  artifact?: ArtifactInfo;
  /** Error message if check failed */
  error?: string;
}

/**
 * Maintenance window configuration
 */
export interface MaintenanceWindow {
  /** Start time in HH:MM format */
  start: string;
  /** End time in HH:MM format */
  end: string;
  /** Timezone (e.g., "UTC", "America/New_York") */
  timezone: string;
}

/**
 * Auto-update configuration
 */
export interface UpdateConfig {
  /** Update channel to track */
  channel: UpdateChannel;
  /** Whether auto-update is enabled */
  autoUpdate: boolean;
  /** Maintenance window for auto-updates (optional) */
  maintenanceWindow?: MaintenanceWindow;
  /** Interval between update checks in milliseconds */
  checkInterval: number;
  /** Path where agent is installed */
  installPath: string;
  /** Vault URL for WebSocket notifications (optional) */
  vaultUrl?: string;
}

/**
 * Stages of the update process
 */
export type UpdateStage =
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'complete'
  | 'error';

/**
 * Progress information during update
 */
export interface UpdateProgress {
  /** Current stage */
  stage: UpdateStage;
  /** Download progress (0-100) */
  progress?: number;
  /** Human-readable message */
  message: string;
  /** Error details if stage is 'error' */
  error?: string;
}

/**
 * Callback for progress updates
 */
export type ProgressCallback = (progress: UpdateProgress) => void;

/**
 * Default configuration values
 */
export const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  channel: 'stable',
  autoUpdate: false,
  checkInterval: 3600000, // 1 hour
  installPath: '/usr/local/bin/znvault',
};

/**
 * S3 base URL for manifests and artifacts
 */
export const S3_BASE_URL = 'https://s3.zincapp.com/zn-releases-prod/vault-agent';

/**
 * Manifest URL for a specific channel
 */
export function getManifestUrl(channel: UpdateChannel): string {
  return `${S3_BASE_URL}/manifests/${channel}.json`;
}

/**
 * Public key URL for signature verification
 */
export function getPublicKeyUrl(): string {
  return `${S3_BASE_URL}/keys/public.asc`;
}
