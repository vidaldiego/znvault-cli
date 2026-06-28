// test/commands/mysql/resolve.test.ts

/**
 * Tests for resolveTarget — turns a connection name/id or alias + optional
 * role name/id into { connectionId, roleId }.
 *
 * Mocking strategy:
 *   - client.get is mocked per-URL via a mockGet helper that switches on the URL.
 *   - getAlias is mocked via vi.mock so config is never touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock the HTTP client module — only the generic get<T>(url) method is needed.
vi.mock('../../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
  },
}));

// Mock alias module so we never touch the real config store.
vi.mock('../../../src/commands/mysql/alias.js', () => ({
  getAlias: vi.fn(),
}));

import { client } from '../../../src/lib/client.js';
import { getAlias } from '../../../src/commands/mysql/alias.js';
import { resolveTarget } from '../../../src/commands/mysql/resolve.js';
import type { DbConnection, DbRole } from '../../../src/commands/dynamic-secrets/types.js';

// Capture typed references to the mock functions so that later calls
// (mockGet.mockImplementation, expect(mockGet).toHaveBeenCalledWith, etc.)
// are made on the local Mock binding and do not trigger the unbound-method rule.
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockGet: Mock = client.get as Mock;
const mockGetAlias: Mock = getAlias as Mock;

const CONNECTION: DbConnection = {
  id: 'dbc_1',
  name: 'staging-mysql',
  tenantId: 't1',
  description: null,
  connectionType: 'MYSQL',
  maxOpenConnections: 10,
  connectionTimeoutSeconds: 5,
  status: 'ACTIVE',
  lastHealthCheck: null,
  lastHealthCheckStatus: null,
  defaultTtlSeconds: 600,
  maxTtlSeconds: 3600,
  createdBy: null,
  createdAt: '',
  updatedAt: '',
};

const ROLE_RW: DbRole = {
  id: 'dbr_rw',
  name: 'app-rw',
  connectionId: 'dbc_1',
  tenantId: 't1',
  description: null,
  defaultTtlSeconds: 600,
  maxTtlSeconds: null,
  usernameTemplate: '',
  isEnabled: true,
  createdBy: null,
  createdAt: '',
  updatedAt: '',
};

const ROLE_RO: DbRole = {
  id: 'dbr_ro',
  name: 'app-ro',
  connectionId: 'dbc_1',
  tenantId: 't1',
  description: null,
  defaultTtlSeconds: 600,
  maxTtlSeconds: null,
  usernameTemplate: '',
  isEnabled: true,
  createdBy: null,
  createdAt: '',
  updatedAt: '',
};

/**
 * Program client.get to return different values based on the URL argument.
 * Roles URL: /v1/dynamic-secrets/connections/<id>/roles
 * Connection URL: /v1/dynamic-secrets/connections/<name-or-id>
 */
function setupClientGet(roles: DbRole[]): void {
  mockGet.mockImplementation((url: string): Promise<DbConnection | DbRole[]> => {
    if (url.startsWith('/v1/dynamic-secrets/connections/') && url.endsWith('/roles')) {
      return Promise.resolve(roles);
    }
    if (url.startsWith('/v1/dynamic-secrets/connections/')) {
      return Promise.resolve(CONNECTION);
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAlias.mockReturnValue(undefined); // default: not an alias
});

describe('resolveTarget', () => {
  describe('explicit connection + role (no alias)', () => {
    it('resolves connection name + role name to ids', async () => {
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-mysql', 'app-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/staging-mysql');
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_1/roles');
    });

    it('resolves role by id when roleOpt matches id', async () => {
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-mysql', 'dbr_ro');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_ro' });
    });

    it('defaults to the single role when no roleOpt is given', async () => {
      setupClientGet([ROLE_RW]); // exactly one role

      const result = await resolveTarget('staging-mysql');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
    });

    it('throws when no roleOpt and multiple roles exist', async () => {
      setupClientGet([ROLE_RW, ROLE_RO]);

      await expect(resolveTarget('staging-mysql')).rejects.toThrow(/--role/);
    });

    it('throws when no roleOpt and zero roles exist', async () => {
      setupClientGet([]);

      await expect(resolveTarget('staging-mysql')).rejects.toThrow(/--role/);
    });

    it('throws when the named role does not exist on the connection', async () => {
      setupClientGet([ROLE_RW]);

      await expect(resolveTarget('staging-mysql', 'nonexistent')).rejects.toThrow(
        /nonexistent/,
      );
    });
  });

  describe('alias resolution', () => {
    it('expands a known alias to connection + role ids', async () => {
      mockGetAlias.mockReturnValue({ connection: 'staging-mysql', role: 'app-rw' });
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      expect(mockGetAlias).toHaveBeenCalledWith('staging-rw');
    });

    it('throws a dangling-alias error when the connection no longer exists', async () => {
      mockGetAlias.mockReturnValue({ connection: 'gone-conn', role: 'app-rw' });
      mockGet.mockRejectedValue(new Error('Not found'));

      await expect(resolveTarget('old-alias')).rejects.toThrow(
        /dangling alias.*old-alias.*connection/i,
      );
    });

    it('throws a dangling-alias error when the role no longer exists', async () => {
      mockGetAlias.mockReturnValue({ connection: 'staging-mysql', role: 'deleted-role' });
      // connection fetch succeeds but roles list has no matching role
      setupClientGet([ROLE_RO]); // only app-ro, not deleted-role

      await expect(resolveTarget('old-alias')).rejects.toThrow(
        /dangling alias.*old-alias.*role/i,
      );
    });
  });
});
