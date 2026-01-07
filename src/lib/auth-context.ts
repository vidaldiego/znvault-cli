// Path: znvault-cli/src/lib/auth-context.ts

import { getCredentials, hasApiKey } from './config.js';

export type UserRole = 'superadmin' | 'admin' | 'user' | 'unknown';

export interface AuthContext {
  isAuthenticated: boolean;
  isSuperadmin: boolean;
  isAdmin: boolean;
  role: UserRole;
  username?: string;
  tenantId?: string;
}

/**
 * Get current authentication context from stored credentials
 * Used by help system to show/hide role-specific commands
 */
export function getAuthContext(): AuthContext {
  const credentials = getCredentials();

  // If using API key, we don't know the role (could be any)
  // So show all commands to be safe
  if (hasApiKey()) {
    return {
      isAuthenticated: true,
      isSuperadmin: true, // Assume superadmin to show all commands
      isAdmin: true,
      role: 'unknown',
    };
  }

  if (!credentials) {
    return {
      isAuthenticated: false,
      isSuperadmin: false,
      isAdmin: false,
      role: 'unknown',
    };
  }

  const role = credentials.role as UserRole;

  return {
    isAuthenticated: true,
    isSuperadmin: role === 'superadmin',
    isAdmin: role === 'admin' || role === 'superadmin',
    role,
    username: credentials.username,
    tenantId: credentials.tenantId ?? undefined,
  };
}

/**
 * Check if current user is a superadmin
 */
export function isSuperadmin(): boolean {
  return getAuthContext().isSuperadmin;
}

/**
 * Check if current user is authenticated
 */
export function isAuthenticated(): boolean {
  return getAuthContext().isAuthenticated;
}
