// Path: src/commands/secret/pem-analysis.ts

/**
 * PEM file analysis utilities for AI suggestion feature
 */

/**
 * PEM file analysis result
 */
export interface PEMInfo {
  type: 'certificate' | 'private-key' | 'public-key' | 'csr' | 'bundle' | 'encrypted-key' | 'unknown';
  algorithm?: 'rsa' | 'ec' | 'ed25519' | 'dsa' | 'unknown';
  pemHeaders: string[];
  blockCount: number;
  certificateCount?: number;
  detectedPurpose?: string;
  isAppleP8?: boolean;
}

/**
 * File analysis info for LLM
 */
export interface FileAnalysisInfo {
  filename: string;
  extension: string;
  mimeType: string;
  size: number;
  pemInfo?: PEMInfo;
}

const PEM_HEADER_MAP: Record<string, { type: PEMInfo['type']; algorithm?: PEMInfo['algorithm'] }> = {
  'PRIVATE KEY': { type: 'private-key' },
  'RSA PRIVATE KEY': { type: 'private-key', algorithm: 'rsa' },
  'EC PRIVATE KEY': { type: 'private-key', algorithm: 'ec' },
  'DSA PRIVATE KEY': { type: 'private-key', algorithm: 'dsa' },
  'OPENSSH PRIVATE KEY': { type: 'private-key' },
  'ENCRYPTED PRIVATE KEY': { type: 'encrypted-key' },
  'PUBLIC KEY': { type: 'public-key' },
  'RSA PUBLIC KEY': { type: 'public-key', algorithm: 'rsa' },
  'EC PUBLIC KEY': { type: 'public-key', algorithm: 'ec' },
  'CERTIFICATE': { type: 'certificate' },
  'X509 CERTIFICATE': { type: 'certificate' },
  'CERTIFICATE REQUEST': { type: 'csr' },
};

export function detectKeyAlgorithm(content: string): PEMInfo['algorithm'] | undefined {
  if (content.includes('EC PRIVATE KEY') || content.includes('EC PUBLIC KEY')) return 'ec';
  if (content.includes('RSA PRIVATE KEY') || content.includes('RSA PUBLIC KEY')) return 'rsa';

  // Check for EC curve OIDs
  const ecOidPatterns = ['BggqhkjOPQMBBw', 'BgUrgQQAIg', 'BgUrgQQAIw'];
  for (const pattern of ecOidPatterns) {
    if (content.includes(pattern)) return 'ec';
  }

  // Size-based heuristic for generic keys
  const keyMatch = /-----BEGIN (?:PRIVATE KEY|PUBLIC KEY)-----\s*([\s\S]*?)\s*-----END/;
  const keyContent = keyMatch.exec(content);
  if (keyContent) {
    const keyBase64 = keyContent[1].replace(/\s/g, '');
    if (keyBase64.length < 400) return 'ec';
    if (keyBase64.length > 1000) return 'rsa';
  }

  return 'unknown';
}

export function detectPurpose(
  filename: string,
  type: PEMInfo['type'],
  algorithm?: PEMInfo['algorithm'],
  headers?: string[]
): string | undefined {
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename.endsWith('.p8') || lowerFilename.includes('authkey')) {
    if (type === 'private-key' && algorithm === 'ec') {
      return 'Apple Push Notification Service (APNS) authentication key';
    }
    return 'Apple authentication key (.p8)';
  }

  if (lowerFilename.includes('ssl') || lowerFilename.includes('tls')) {
    if (type === 'certificate') return 'SSL/TLS certificate';
    if (type === 'private-key') return 'SSL/TLS private key';
    if (type === 'bundle') return 'SSL/TLS certificate bundle';
  }

  if (lowerFilename.includes('ca') || lowerFilename.includes('root') || lowerFilename.includes('intermediate')) {
    if (type === 'certificate') return 'Certificate Authority (CA) certificate';
    if (type === 'bundle') return 'CA certificate chain';
  }

  // JWT/API signing (check before generic "sign" to avoid false matches)
  if (lowerFilename.includes('jwt') || lowerFilename.includes('signing')) {
    if (type === 'private-key') return 'JWT/API signing key';
    if (type === 'public-key') return 'JWT/API verification key';
  }

  // Code signing (codesign specifically, not just "sign")
  if (lowerFilename.includes('codesign') || (lowerFilename.includes('sign') && !lowerFilename.includes('signing'))) {
    if (type === 'certificate') return 'Code signing certificate';
    if (type === 'private-key') return 'Code signing private key';
  }

  if (lowerFilename.includes('ssh') || lowerFilename.startsWith('id_') || headers?.some(h => h.includes('OPENSSH'))) {
    if (type === 'private-key') return 'SSH private key';
    if (type === 'public-key') return 'SSH public key';
  }

  if (type === 'certificate') return 'X.509 certificate';
  if (type === 'bundle') return 'Certificate bundle/chain';
  if (type === 'csr') return 'Certificate Signing Request (CSR)';
  if (type === 'encrypted-key') return 'Encrypted private key (password protected)';

  return undefined;
}

export function analyzePEMContent(content: string, filename: string): PEMInfo | null {
  const headerRegex = /-----BEGIN ([A-Z0-9 ]+)-----/g;
  const headers: string[] = [];
  let match;

  while ((match = headerRegex.exec(content)) !== null) {
    headers.push(match[1]);
  }

  if (headers.length === 0) return null;

  const certificateCount = headers.filter(h => h.includes('CERTIFICATE')).length;
  const privateKeyHeaders = headers.filter(h => h.includes('PRIVATE KEY'));
  const publicKeyHeaders = headers.filter(h => h.includes('PUBLIC KEY'));
  const csrHeaders = headers.filter(h => h.includes('CERTIFICATE REQUEST'));

  let type: PEMInfo['type'] = 'unknown';
  let algorithm: PEMInfo['algorithm'] | undefined;

  if (certificateCount > 1 || (certificateCount >= 1 && privateKeyHeaders.length >= 1)) {
    type = 'bundle';
  } else if (privateKeyHeaders.length > 0) {
    const keyHeader = privateKeyHeaders[0];
    const mapping = PEM_HEADER_MAP[keyHeader];
    type = mapping?.type ?? 'private-key';
    algorithm = mapping?.algorithm;
    if (keyHeader.includes('ENCRYPTED')) type = 'encrypted-key';
  } else if (publicKeyHeaders.length > 0) {
    const keyHeader = publicKeyHeaders[0];
    const mapping = PEM_HEADER_MAP[keyHeader];
    type = mapping?.type ?? 'public-key';
    algorithm = mapping?.algorithm;
  } else if (csrHeaders.length > 0) {
    type = 'csr';
  } else if (certificateCount > 0) {
    type = 'certificate';
  }

  if (!algorithm && (type === 'private-key' || type === 'public-key')) {
    algorithm = detectKeyAlgorithm(content);
  }

  const detectedPurpose = detectPurpose(filename, type, algorithm, headers);
  const lowerFilename = filename.toLowerCase();
  const isAppleP8 = type === 'private-key' && algorithm === 'ec' &&
    (lowerFilename.endsWith('.p8') || lowerFilename.includes('authkey'));

  return {
    type,
    algorithm,
    pemHeaders: headers,
    blockCount: headers.length,
    certificateCount: certificateCount > 0 ? certificateCount : undefined,
    detectedPurpose,
    isAppleP8: isAppleP8 || undefined,
  };
}

export function detectMimeType(content: Buffer): string {
  const text = content.toString('utf8', 0, 100);
  if (text.includes('-----BEGIN')) return 'application/x-pem-file';
  return 'application/octet-stream';
}

export async function analyzeFileForSuggestion(filePath: string): Promise<FileAnalysisInfo | null> {
  const fs = await import('fs');
  const pathModule = await import('path');

  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath);
  const filename = pathModule.basename(filePath);
  const extension = pathModule.extname(filePath).toLowerCase();
  const mimeType = detectMimeType(content);

  const result: FileAnalysisInfo = {
    filename,
    extension,
    mimeType,
    size: content.length,
  };

  // Analyze PEM content for relevant file types
  const pemExtensions = ['.pem', '.crt', '.cer', '.key', '.p8', '.p12', '.pfx', '.pub'];
  if (mimeType === 'application/x-pem-file' || pemExtensions.includes(extension)) {
    const textContent = content.toString('utf8');
    const pemInfo = analyzePEMContent(textContent, filename);
    if (pemInfo) {
      result.pemInfo = pemInfo;
    }
  }

  return result;
}

export function formatPemType(type: string): string {
  const typeMap: Record<string, string> = {
    'private-key': 'Private Key',
    'public-key': 'Public Key',
    'certificate': 'X.509 Certificate',
    'csr': 'Certificate Signing Request',
    'bundle': 'Certificate Bundle/Chain',
    'encrypted-key': 'Encrypted Private Key',
    'unknown': 'Unknown PEM format',
  };
  return typeMap[type] ?? type;
}
