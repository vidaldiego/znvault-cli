// Path: src/commands/ssh/helpers.ts

/**
 * SSH CA command helper functions
 */

import { client } from '../../lib/client.js';
import { formatTtl, parseTtl } from '../../lib/format-helpers.js';
import type { SignResult } from './types.js';

// Re-export common formatters from centralized location
export { formatTtl, parseTtl };

/**
 * Get path to the default SSH key
 */
export async function getDefaultKeyPath(): Promise<string | null> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const sshDir = path.join(os.homedir(), '.ssh');
  const keyTypes = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

  for (const keyType of keyTypes) {
    const keyPath = path.join(sshDir, keyType);
    const pubPath = path.join(sshDir, `${keyType}.pub`);
    if (fs.existsSync(keyPath) && fs.existsSync(pubPath)) {
      return keyPath;
    }
  }
  return null;
}

/**
 * Get the certificate path for a given key path
 */
export async function getCertificatePath(keyPath: string): Promise<string> {
  const path = await import('path');
  const dir = path.dirname(keyPath);
  const base = path.basename(keyPath);
  return path.join(dir, `${base}-cert.pub`);
}

/**
 * Check if a certificate is valid (exists and not expired)
 */
export async function isCertificateValid(certPath: string): Promise<{ valid: boolean; reason?: string }> {
  const fs = await import('fs');
  const { execSync } = await import('child_process');

  if (!fs.existsSync(certPath)) {
    return { valid: false, reason: 'Certificate does not exist' };
  }

  try {
    // Use ssh-keygen -L to inspect the certificate
    const output = execSync(`ssh-keygen -L -f "${certPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Parse "Valid: from YYYY-MM-DDTHH:MM:SS to YYYY-MM-DDTHH:MM:SS"
    const validMatch = /Valid:\s+from\s+(\S+)\s+to\s+(\S+)/.exec(output);
    if (!validMatch) {
      return { valid: false, reason: 'Could not parse certificate validity' };
    }

    const validBefore = new Date(validMatch[2]);
    const now = new Date();

    // Check if expired (with 5 minute buffer)
    if (validBefore.getTime() - now.getTime() < 5 * 60 * 1000) {
      return { valid: false, reason: 'Certificate expired or expiring soon' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Failed to inspect certificate' };
  }
}

/**
 * Sign a certificate using the vault API
 */
export async function signCertificate(
  publicKeyPath: string,
  certPath: string,
  principals?: string,
  ttl?: string,
  tenant?: string
): Promise<void> {
  const fs = await import('fs');

  const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
  const query = tenant ? `?tenantId=${encodeURIComponent(tenant)}` : '';

  interface SignBody {
    publicKey: string;
    ttlSeconds?: number;
    principals?: string[];
  }

  const body: SignBody = { publicKey };
  if (ttl) {
    body.ttlSeconds = parseTtl(ttl);
  }
  if (principals) {
    body.principals = principals.split(',').map(p => p.trim());
  }

  const result = await client.post<SignResult>(`/v1/ssh/sign${query}`, body);
  fs.writeFileSync(certPath, result.certificate + '\n');
}

/**
 * Check if a certificate is expired
 */
export function isExpired(validBefore: string): boolean {
  return new Date(validBefore) < new Date();
}

/**
 * Build tenant query string parameter
 */
export function buildTenantQuery(tenant?: string): string {
  return tenant ? `?tenantId=${encodeURIComponent(tenant)}` : '';
}

/**
 * Parse local certificate details using ssh-keygen
 */
export async function parseCertificateInfo(certPath: string): Promise<{
  valid: boolean;
  principals: string[];
  validAfter: Date | null;
  validBefore: Date | null;
  fingerprint: string | null;
  keyId: string | null;
  serial: string | null;
}> {
  const fs = await import('fs');
  const { execSync } = await import('child_process');

  if (!fs.existsSync(certPath)) {
    return {
      valid: false,
      principals: [],
      validAfter: null,
      validBefore: null,
      fingerprint: null,
      keyId: null,
      serial: null,
    };
  }

  try {
    const output = execSync(`ssh-keygen -L -f "${certPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Parse principals
    const principals: string[] = [];
    const principalsMatch = /Principals:\s*([\s\S]*?)(?=\s+Critical Options:)/.exec(output);
    if (principalsMatch) {
      const lines = principalsMatch[1].trim().split('\n');
      for (const line of lines) {
        const principal = line.trim();
        if (principal) {
          principals.push(principal);
        }
      }
    }

    // Parse validity
    const validMatch = /Valid:\s+from\s+(\S+)\s+to\s+(\S+)/.exec(output);
    const validAfter = validMatch ? new Date(validMatch[1]) : null;
    const validBefore = validMatch ? new Date(validMatch[2]) : null;

    // Parse fingerprint
    const fpMatch = /Public key:.*?(\S+:\S+)/.exec(output);
    const fingerprint = fpMatch ? fpMatch[1] : null;

    // Parse key ID
    const keyIdMatch = /Key ID:\s*"([^"]+)"/.exec(output);
    const keyId = keyIdMatch ? keyIdMatch[1] : null;

    // Parse serial
    const serialMatch = /Serial:\s*(\d+)/.exec(output);
    const serial = serialMatch ? serialMatch[1] : null;

    // Check validity
    const now = new Date();
    const valid = validBefore ? validBefore.getTime() > now.getTime() : false;

    return { valid, principals, validAfter, validBefore, fingerprint, keyId, serial };
  } catch {
    return {
      valid: false,
      principals: [],
      validAfter: null,
      validBefore: null,
      fingerprint: null,
      keyId: null,
      serial: null,
    };
  }
}

/**
 * Format remaining time as human-readable string
 */
export function formatRemainingTime(validBefore: Date): string {
  const now = new Date();
  const diff = validBefore.getTime() - now.getTime();

  if (diff <= 0) {
    return 'expired';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
