// Path: znvault-cli/src/commands/backup/types.ts
// Type definitions for backup CLI commands

export interface Backup {
  id: string;
  filename: string;
  storageIdentifier: string;
  storageType: 'local' | 's3' | 'sftp';
  status: 'pending' | 'completed' | 'failed' | 'verified';
  dbSizeBytes: number;
  backupSizeBytes: number;
  encrypted: boolean;
  checksum?: string;
  initiatedBy: 'scheduled' | 'manual';
  verifiedAt?: string;
  metadata?: {
    duration?: number;
    compressionRatio?: number;
  };
  createdAt: string;
  completedAt?: string;
}

export interface BackupListResponse {
  items: Backup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BackupStats {
  totalBackups: number;
  totalSizeBytes: number;
  lastBackup?: string;
  lastSuccessful?: string;
  verifiedCount: number;
  failedCount: number;
}

export interface S3Config {
  bucket?: string;
  region?: string;
  prefix?: string;
  endpoint?: string;
  hasCredentials?: boolean;
}

export interface SftpConfig {
  host?: string;
  port?: number;
  username?: string;
  remotePath?: string;
  hasCredentials?: boolean;
}

export interface LocalConfig {
  path?: string;
}

export interface StorageConfig {
  type: 'local' | 's3' | 'sftp';
  local?: LocalConfig;
  s3?: S3Config;
  sftp?: SftpConfig;
}

export interface EncryptionConfig {
  enabled: boolean;
  hasPassword?: boolean;
}

export interface BackupConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: number;
  retentionCount: number;
  storage?: StorageConfig;
  encryption?: EncryptionConfig;
}

export interface BackupHealth {
  healthy: boolean;
  lastBackupAge?: number;
  lastBackupStatus?: string;
  storageAccessible: boolean;
  warnings?: string[];
}

export interface ListOptions {
  status?: string;
  limit?: string;
  json?: boolean;
}

export interface GetOptions {
  json?: boolean;
}

export interface ConfigOptions {
  enabled?: boolean;
  interval?: string;
  retentionDays?: string;
  retentionCount?: string;
  json?: boolean;
}

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  prefix?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  json?: boolean;
}

export interface LocalStorageOptions {
  path: string;
  json?: boolean;
}

export interface EncryptionOptions {
  enable?: boolean;
  disable?: boolean;
  passwordFile?: string;
  json?: boolean;
}

export interface DeleteOptions {
  force?: boolean;
}

export interface RestoreOptions {
  userKey?: string;
  userKeyFile?: string;
  password?: string;
  passwordFile?: string;
  restoreLmk?: boolean;
  noPreBackup?: boolean;
  force?: boolean;
}

export interface CreateBackupOptions {
  userKey?: string;
  userKeyFile?: string;
}

export interface GenerateKeyOptions {
  output?: string;
  json?: boolean;
}

export interface GenerateKeyResponse {
  hex: string;
  base64: string;
  keyId: string;
  instructions: string;
}

export interface RestoreResult {
  message: string;
  preRestoreBackupId?: string;
  tablesRestored: number;
  lmkRestored: boolean;
  duration: number;
  warnings: string[];
}
