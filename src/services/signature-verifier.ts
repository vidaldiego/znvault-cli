// Path: znvault-cli/src/services/signature-verifier.ts

/**
 * Signature Verification Service
 *
 * Verifies GPG signatures and SHA256 checksums for agent updates.
 * Uses the openpgp library for pure JavaScript implementation.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as https from 'https';
import * as openpgp from 'openpgp';
import { getPublicKeyUrl } from '../types/update.js';

/**
 * Embedded public key for verification
 * This is the fallback key used when the remote key cannot be fetched.
 * It should be updated when the signing key is rotated.
 *
 * Key ID: 8E703B1277C29EEFADA1C7AF843C39536B732281
 * Email: agent-releases@zincapp.com
 */
const EMBEDDED_PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

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
WHcbEBz8WFnmLA==
=TbOo
-----END PGP PUBLIC KEY BLOCK-----`;

export class SignatureVerifier {
  private publicKeyArmored: string | null = null;
  private publicKeyFetched = false;

  /**
   * Verify SHA256 checksum of a file
   */
  verifyChecksum(filePath: string, expectedSha256: string): boolean {
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash.toLowerCase() === expectedSha256.toLowerCase();
  }

  /**
   * Calculate SHA256 checksum of a file
   */
  calculateChecksum(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Fetch the public key from S3
   */
  private async fetchPublicKey(): Promise<string> {
    if (this.publicKeyArmored) {
      return this.publicKeyArmored;
    }

    const url = getPublicKeyUrl();

    return new Promise((resolve, reject) => {
      https.get(url, { rejectUnauthorized: true }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch public key: HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          this.publicKeyArmored = data;
          this.publicKeyFetched = true;
          resolve(data);
        });
      }).on('error', reject);
    });
  }

  /**
   * Get the public key for verification
   * Tries to fetch from S3, falls back to embedded key
   */
  private async getPublicKey(): Promise<string> {
    if (this.publicKeyArmored) {
      return this.publicKeyArmored;
    }

    try {
      return await this.fetchPublicKey();
    } catch (err) {
      console.warn('Failed to fetch public key from S3, using embedded key');
      this.publicKeyArmored = EMBEDDED_PUBLIC_KEY;
      return EMBEDDED_PUBLIC_KEY;
    }
  }

  /**
   * Verify GPG signature of a file
   *
   * @param filePath - Path to the file to verify
   * @param signatureBase64 - Base64-encoded detached signature
   * @returns true if signature is valid
   */
  async verifySignature(filePath: string, signatureBase64: string): Promise<boolean> {
    try {
      const publicKeyArmored = await this.getPublicKey();

      // Check if signature is empty (release not signed)
      if (!signatureBase64 || signatureBase64.trim() === '') {
        console.warn('WARNING: Release is not signed - signature verification skipped');
        return true; // Allow unsigned releases (e.g., during development)
      }

      // Read the file to verify
      const fileData = fs.readFileSync(filePath);

      // Decode the signature from base64
      const signatureArmored = Buffer.from(signatureBase64, 'base64').toString('utf-8');

      // Read the public key
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

      // Read the signature
      const signature = await openpgp.readSignature({ armoredSignature: signatureArmored });

      // Create a message from the file data
      const message = await openpgp.createMessage({ binary: fileData });

      // Verify the signature
      const verificationResult = await openpgp.verify({
        message,
        signature,
        verificationKeys: publicKey,
      });

      // Check if any signature is valid
      const { verified } = verificationResult.signatures[0];
      await verified; // throws on invalid signature

      return true;
    } catch (err) {
      console.error('Signature verification failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * Verify both checksum and signature
   */
  async verifyArtifact(
    filePath: string,
    expectedSha256: string,
    signatureBase64: string
  ): Promise<{ valid: boolean; error?: string }> {
    // First verify checksum (fast)
    if (!this.verifyChecksum(filePath, expectedSha256)) {
      return { valid: false, error: 'Checksum verification failed - file may be corrupted' };
    }

    // Then verify signature (slower)
    const signatureValid = await this.verifySignature(filePath, signatureBase64);
    if (!signatureValid) {
      return { valid: false, error: 'Signature verification failed - file may be tampered' };
    }

    return { valid: true };
  }
}

// Singleton instance
let verifierInstance: SignatureVerifier | null = null;

export function getSignatureVerifier(): SignatureVerifier {
  if (!verifierInstance) {
    verifierInstance = new SignatureVerifier();
  }
  return verifierInstance;
}
