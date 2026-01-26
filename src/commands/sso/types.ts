// Path: src/commands/sso/types.ts

/**
 * SSO command types and interfaces
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface SSOApp {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  allowed_origins: string[];
  allowed_scopes: string[];
  allowed_grant_types: string[];
  access_token_ttl_seconds: number;
  refresh_token_ttl_seconds: number;
  require_pkce: boolean;
  active: boolean;
  icon_url: string | null;
  roles: string[];
  default_role: string;
  created_at: string;
  updated_at: string;
  user_count?: number;
  active_token_count?: number;
}

export interface SSOAppUser {
  user_id: string;
  username: string;
  email: string | null;
  role: string;
  granted_at: string;
  granted_by: string | null;
  last_used_at: string | null;
}

export interface ListAppsResponse {
  apps: SSOApp[];
  pagination: { total: number };
}

export interface ListUsersResponse {
  users: SSOAppUser[];
  pagination: { total: number };
}

export interface CreateAppResponse {
  app: SSOApp;
  client_secret: string;
}

export interface RotateSecretResponse {
  client_secret: string;
  rotated_at: string;
}

// ============================================================================
// Command Option Types
// ============================================================================

export interface ListOptions {
  tenant?: string;
  status?: string;
  json?: boolean;
}

export interface GetOptions {
  tenant?: string;
  json?: boolean;
}

export interface CreateOptions {
  tenant?: string;
  description?: string;
  redirectUri: string[];
  origin?: string[];
  scope?: string[];
  grantType?: string[];
  tokenTtl?: string;
  refreshTtl?: string;
  pkce?: boolean;
  role?: string[];
  defaultRole?: string;
  json?: boolean;
}

export interface UpdateOptions {
  tenant?: string;
  name?: string;
  description?: string;
  addRedirectUri?: string[];
  removeRedirectUri?: string[];
  addOrigin?: string[];
  removeOrigin?: string[];
  addScope?: string[];
  removeScope?: string[];
  tokenTtl?: string;
  refreshTtl?: string;
  pkce?: boolean;
  status?: string;
  json?: boolean;
}

export interface DeleteOptions {
  tenant?: string;
  yes?: boolean;
}

export interface RotateSecretOptions {
  tenant?: string;
  json?: boolean;
}

export interface UserListOptions {
  tenant?: string;
  json?: boolean;
}

export interface UserRevokeOptions {
  tenant?: string;
  yes?: boolean;
}

export interface UserSetRoleOptions {
  tenant?: string;
}

export interface UserGrantOptions {
  tenant?: string;
  role?: string;
}
