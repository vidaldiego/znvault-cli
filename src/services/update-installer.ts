// Path: znvault-cli/src/services/update-installer.ts

/**
 * Update Installer Service
 *
 * Downloads, verifies, and installs agent updates with atomic replacement
 * and automatic rollback on failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getSignatureVerifier } from './signature-verifier.js';
import type { ArtifactInfo, UpdateProgress, ProgressCallback } from '../types/update.js';
import { getInstallPath } from '../utils/platform.js';

const execAsync = promisify(exec);

export class UpdateInstaller {
  private installPath: string;
  private onProgress?: ProgressCallback;

  constructor(installPath?: string, onProgress?: ProgressCallback) {
    this.installPath = installPath ?? getInstallPath();
    this.onProgress = onProgress;
  }

  /**
   * Report progress to callback
   */
  private report(progress: UpdateProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Download file with progress reporting
   */
  private async download(
    url: string,
    destPath: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      https.get(url, { rejectUnauthorized: true }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Handle redirect
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(destPath);
            this.download(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed: HTTP ${String(res.statusCode)}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] ?? '0', 10);
        let downloadedSize = 0;

        res.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          if (totalSize > 0 && onProgress) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            onProgress(percent);
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          file.close();
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(err);
      });
    });
  }

  /**
   * Extract tarball to directory
   */
  private async extractTarball(tarballPath: string, extractDir: string): Promise<void> {
    await execAsync(`tar -xzf "${tarballPath}" -C "${extractDir}"`);
  }

  /**
   * Find the binary in extracted directory
   */
  private findBinary(extractDir: string): string | null {
    // Check common locations
    const candidates = [
      path.join(extractDir, 'znvault'),
      path.join(extractDir, 'bin', 'znvault'),
      path.join(extractDir, 'vault-agent'),
      path.join(extractDir, 'bin', 'vault-agent'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Search recursively
    const files = fs.readdirSync(extractDir);
    for (const file of files) {
      const filePath = path.join(extractDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const found = this.findBinary(filePath);
        if (found) return found;
      } else if (file === 'znvault' || file === 'vault-agent') {
        return filePath;
      }
    }

    return null;
  }

  /**
   * Install the update
   *
   * @param artifact - Artifact info with URL, checksum, and signature
   * @param version - Version being installed
   */
  async install(artifact: ArtifactInfo, version: string): Promise<void> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-update-'));
    const tarballPath = path.join(tmpDir, `vault-agent_${version}.tar.gz`);
    const extractDir = path.join(tmpDir, 'extracted');

    try {
      // 1. Download
      this.report({
        stage: 'downloading',
        progress: 0,
        message: 'Downloading update...',
      });

      await this.download(artifact.url, tarballPath, (progress) => {
        this.report({
          stage: 'downloading',
          progress,
          message: `Downloading: ${progress}%`,
        });
      });

      // 2. Verify checksum
      this.report({
        stage: 'verifying',
        message: 'Verifying checksum...',
      });

      const verifier = getSignatureVerifier();

      if (!verifier.verifyChecksum(tarballPath, artifact.sha256)) {
        throw new Error('Checksum verification failed - file may be corrupted');
      }

      // 3. Verify signature
      this.report({
        stage: 'verifying',
        message: 'Verifying GPG signature...',
      });

      const signatureValid = await verifier.verifySignature(tarballPath, artifact.signature);
      if (!signatureValid) {
        throw new Error('Signature verification failed - update may be tampered');
      }

      // 4. Extract
      this.report({
        stage: 'installing',
        message: 'Extracting update...',
      });

      fs.mkdirSync(extractDir, { recursive: true });
      await this.extractTarball(tarballPath, extractDir);

      // 5. Find binary
      const newBinaryPath = this.findBinary(extractDir);
      if (!newBinaryPath) {
        throw new Error('Could not find binary in extracted archive');
      }

      // 6. Install (directory-based for node packages, binary for standalone)
      this.report({
        stage: 'installing',
        message: 'Installing update...',
      });

      // Check if this is a node package (has dist/) or standalone binary
      const hasDistDir = fs.existsSync(path.join(extractDir, 'dist'));
      if (hasDistDir) {
        // Node package: install entire directory
        await this.installDirectory(extractDir);
      } else {
        // Standalone binary: atomic replacement
        this.atomicReplace(newBinaryPath);
      }

      // 7. Complete
      this.report({
        stage: 'complete',
        message: `Successfully updated to version ${version}`,
      });
    } catch (err) {
      this.report({
        stage: 'error',
        message: 'Update failed',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      // Cleanup temp directory
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Install a directory-based package (Node.js with dist/)
   */
  private async installDirectory(extractDir: string): Promise<void> {
    const installDir = path.dirname(this.installPath);
    const backupDir = `${installDir}.backup`;

    // Ensure parent directory exists
    const parentDir = path.dirname(installDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Backup current installation if it exists
    const hasExisting = fs.existsSync(installDir);
    if (hasExisting) {
      // Remove old backup if exists
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
      fs.renameSync(installDir, backupDir);
    }

    try {
      // Copy extracted contents to install directory
      fs.mkdirSync(installDir, { recursive: true });
      await this.copyDirectory(extractDir, installDir);

      // Make wrapper script executable
      if (fs.existsSync(this.installPath)) {
        fs.chmodSync(this.installPath, 0o755);
      }

      // Remove backup on success
      if (hasExisting && fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (err) {
      // Rollback on failure
      if (hasExisting && fs.existsSync(backupDir)) {
        try {
          if (fs.existsSync(installDir)) {
            fs.rmSync(installDir, { recursive: true, force: true });
          }
          fs.renameSync(backupDir, installDir);
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
      }
      throw err;
    }
  }

  /**
   * Recursively copy a directory
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Atomically replace the binary with rollback on failure
   */
  private atomicReplace(newBinaryPath: string): void {
    const backupPath = `${this.installPath}.backup`;
    const installDir = path.dirname(this.installPath);

    // Ensure install directory exists
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    // Backup current binary if it exists
    const hasExisting = fs.existsSync(this.installPath);
    if (hasExisting) {
      fs.copyFileSync(this.installPath, backupPath);
    }

    try {
      // Copy new binary to temp location in target directory
      const tempPath = `${this.installPath}.new`;
      fs.copyFileSync(newBinaryPath, tempPath);
      fs.chmodSync(tempPath, 0o755);

      // Atomic rename
      fs.renameSync(tempPath, this.installPath);

      // Remove backup on success
      if (hasExisting && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (err) {
      // Rollback on failure
      if (hasExisting && fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, this.installPath);
          fs.unlinkSync(backupPath);
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
      }
      throw err;
    }
  }

  /**
   * Check if we have permission to install
   */
  canInstall(): { canInstall: boolean; reason?: string } {
    const installDir = path.dirname(this.installPath);

    // Check if directory exists and is writable
    try {
      if (!fs.existsSync(installDir)) {
        // Check if we can create it
        const parentDir = path.dirname(installDir);
        fs.accessSync(parentDir, fs.constants.W_OK);
      } else {
        fs.accessSync(installDir, fs.constants.W_OK);
      }

      // If binary exists, check if we can write to it
      if (fs.existsSync(this.installPath)) {
        fs.accessSync(this.installPath, fs.constants.W_OK);
      }

      return { canInstall: true };
    } catch {
      return {
        canInstall: false,
        reason: `No write permission to ${this.installPath}. Run with sudo or change install path.`,
      };
    }
  }

  /**
   * Get the install path
   */
  getInstallPath(): string {
    return this.installPath;
  }
}

// Factory function
export function createUpdateInstaller(
  installPath?: string,
  onProgress?: ProgressCallback
): UpdateInstaller {
  return new UpdateInstaller(installPath, onProgress);
}
