// Path: src/lib/db/emergency.ts

/**
 * Emergency database operations
 */

import bcryptjs from 'bcryptjs';
import type { User } from '../../types/index.js';
import type { UserRow } from './types.js';
import { BaseDBClient } from './client.js';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface UserStatusResult {
  found: boolean;
  user?: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    status: string;
    totpEnabled: boolean;
    failedAttempts: number;
    lockedUntil: string | null;
    lastLogin: string | null;
  };
}

export interface OperationResult {
  success: boolean;
  message: string;
}

export class EmergencyOperations extends BaseDBClient {
  /**
   * Test database connection
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.connect();
      const result = await this.queryOne<{ time: Date; db: string }>(
        'SELECT NOW() as time, current_database() as db'
      );
      return {
        success: true,
        message: `Connected to database '${result?.db ?? 'unknown'}' at ${result?.time.toISOString() ?? 'unknown'}`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Get user by username (for internal use)
   */
  private async getUserByUsername(username: string): Promise<User | null> {
    const row = await this.queryOne<UserRow>(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      email: row.email ?? undefined,
      role: row.role as 'user' | 'admin' | 'superadmin',
      tenantId: row.tenant_id ?? undefined,
      status: row.status as 'active' | 'disabled' | 'locked',
      totpEnabled: row.totp_enabled,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until?.toISOString(),
      lastLogin: row.last_login?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  /**
   * Get user status (for diagnostics)
   */
  async getUserStatus(username: string): Promise<UserStatusResult> {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return { found: false };
    }

    return {
      found: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email ?? null,
        role: user.role,
        status: user.status,
        totpEnabled: user.totpEnabled,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil ?? null,
        lastLogin: user.lastLogin ?? null,
      },
    };
  }

  /**
   * Reset a user's password directly in the database.
   */
  async resetPassword(username: string, newPassword: string): Promise<OperationResult> {
    await this.connect();

    const client = this.getRawClient();
    try {
      await client.query('BEGIN');
      const findQuery = await client.query<{id: string; username: string}>(
        'SELECT id, username FROM users WHERE username = $1 OR email = $1 FOR UPDATE',
        [username],
      );
      const findResult = findQuery.rows.at(0);

      if (!findResult) {
        await client.query('ROLLBACK');
        return { success: false, message: `User '${username}' not found` };
      }

      // Direct/local reset has no password-derived private-key rewrap ceremony.
      // Refuse instead of leaving current grants cryptographically stranded or
      // allowing old distributed unlock capabilities to survive the reset.
      const capability = await client.query<{user_secret_keys: string | null}>(
        "SELECT to_regclass('public.user_secret_keys')::text AS user_secret_keys",
      );
      if (capability.rows[0]?.user_secret_keys) {
        const userSealed = await client.query<{has_key: boolean}>(
          'SELECT EXISTS(SELECT 1 FROM user_secret_keys WHERE user_id = $1) AS has_key',
          [findResult.id],
        );
        if (userSealed.rows[0]?.has_key) {
          await client.query('ROLLBACK');
          return {
            success: false,
            message: 'USER_SEALED_PASSWORD_RESET_REQUIRES_API: direct database reset is blocked because this user has User-Sealed key material. Use the authenticated API reset/recovery ceremony so key rotation, grant coverage, and session epochs remain atomic.',
          };
        }
      }

      const passwordHash = bcryptjs.hashSync(newPassword, 12);
      await client.query(
        `UPDATE users SET
          password_hash = $1,
          totp_enabled = false,
          totp_secret_cipher = NULL,
          totp_nonce = NULL,
          totp_tag = NULL,
          backup_codes_cipher = NULL,
          backup_codes_nonce = NULL,
          backup_codes_tag = NULL,
          failed_attempts = 0,
          locked_until = NULL,
          status = 'active',
          password_must_change = true,
          updated_at = NOW()
        WHERE id = $2`,
        [passwordHash, findResult.id]
      );
      await client.query('COMMIT');

      return {
        success: true,
        message: `Password reset for user '${findResult.username}'. TOTP disabled, account unlocked.`,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      return {
        success: false,
        message: `Failed to reset password: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Unlock a locked user account
   */
  async unlockUser(username: string): Promise<OperationResult> {
    await this.connect();

    try {
      const findResult = await this.queryOne<{
        id: string;
        username: string;
        status: string;
        failed_attempts: number;
        locked_until: Date | null;
      }>(
        'SELECT id, username, status, failed_attempts, locked_until FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (!findResult) {
        return { success: false, message: `User '${username}' not found` };
      }

      if (findResult.status === 'active' && findResult.failed_attempts === 0 && !findResult.locked_until) {
        return { success: true, message: `User '${findResult.username}' is already unlocked` };
      }

      const client = this.getRawClient();
      await client.query(
        `UPDATE users SET
          status = 'active',
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
        WHERE id = $1`,
        [findResult.id]
      );

      return {
        success: true,
        message: `User '${findResult.username}' has been unlocked`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to unlock user: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Disable TOTP for a user
   */
  async disableTotp(username: string): Promise<OperationResult> {
    await this.connect();

    try {
      const findResult = await this.queryOne<{
        id: string;
        username: string;
        totp_enabled: boolean;
      }>(
        'SELECT id, username, totp_enabled FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (!findResult) {
        return { success: false, message: `User '${username}' not found` };
      }

      if (!findResult.totp_enabled) {
        return { success: true, message: `TOTP is already disabled for '${findResult.username}'` };
      }

      const client = this.getRawClient();
      await client.query(
        `UPDATE users SET
          totp_enabled = false,
          totp_secret_cipher = NULL,
          totp_nonce = NULL,
          totp_tag = NULL,
          backup_codes_cipher = NULL,
          backup_codes_nonce = NULL,
          backup_codes_tag = NULL,
          updated_at = NOW()
        WHERE id = $1`,
        [findResult.id]
      );

      return {
        success: true,
        message: `TOTP disabled for user '${findResult.username}'`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to disable TOTP: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
