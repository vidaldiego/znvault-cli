// Path: src/commands/kmip/types.ts
// Types for the `znvault kmip` command group (Synology encryption key vault).

export interface KmipClient {
  id: string;
  name: string;
  description: string | null;
  certFingerprint: string;
  certSerial: string | null;
  certNotAfter: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  allowedSourceCidrs?: string[];
}

export interface KmipClientBundle {
  clientKeyPem: string;
  clientCertPem: string;
  caCertPem: string;
}

export interface KmipClientCreateResponse extends KmipClient {
  bundle: KmipClientBundle;
}

export interface KmipObject {
  id: string;
  objectType: string;
  secretDataType: string | null;
  keyFormatType: string;
  state: string;
  names: string[];
  clientId: string | null;
  cryptographicUsageMask: number;
  initialDate: string | null;
  activationDate: string | null;
  deactivationDate: string | null;
  compromiseDate: string | null;
  destroyDate: string | null;
}

export interface KmipConfigStatus {
  listener: { enabled: boolean; listening: boolean; port: number };
  pkiInitialized: boolean;
  caCertPem: string | null;
  serverCertNotAfter: string | null;
  serverCertDaysToExpiry: number | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}
