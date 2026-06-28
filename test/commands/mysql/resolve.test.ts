// test/commands/mysql/resolve.test.ts

/**
 * Tests for resolveTarget — turns a connection name/id or alias + optional
 * role name/id into { connectionId, roleId }.
 *
 * Mocking strategy:
 *   - client.get is mocked per-URL via a mockGet helper that switches on the URL.
 *   - getAlias is mocked via vi.mock so config is never touched.
 *
 * URL routing in mocks:
 *   - LIST url:       '/v1/dynamic-secrets/connections'         (no trailing segment)
 *   - GET-by-id url:  '/v1/dynamic-secrets/connections/<id>'    (has trailing segment, not '/roles')
 *   - ROLES url:      '/v1/dynamic-secrets/connections/<id>/roles' (ends with '/roles')
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

const CONNECTION_LIST: DbConnection[] = [CONNECTION];

/**
 * Program client.get to return different values based on the URL argument.
 *
 * URL dispatch order (most specific first):
 *   1. Ends with '/roles'             → roles array
 *   2. Exact LIST url (no id segment) → connections array
 *   3. GET-by-id url (has id segment) → single connection or 404
 */
function setupClientGet(
  roles: DbRole[],
  opts: {
    /** If true, the GET-by-id call 404s (simulates name-only lookup). */
    getByIdFails?: boolean;
    /** Connections returned by the LIST endpoint. Defaults to [CONNECTION]. */
    connectionList?: DbConnection[];
  } = {},
): void {
  const list = opts.connectionList ?? CONNECTION_LIST;
  const getByIdFails = opts.getByIdFails ?? false;

  mockGet.mockImplementation((url: string): Promise<DbConnection | DbConnection[] | DbRole[]> => {
    // 1. Roles endpoint.
    if (url.endsWith('/roles')) {
      return Promise.resolve(roles);
    }

    // 2. LIST endpoint (exact — no trailing id segment).
    if (url === '/v1/dynamic-secrets/connections') {
      return Promise.resolve(list);
    }

    // 3. GET-by-id endpoint.
    if (url.startsWith('/v1/dynamic-secrets/connections/')) {
      if (getByIdFails) {
        return Promise.reject(new Error('404 Not Found'));
      }
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
  describe('explicit connection by id (starts with dbc_)', () => {
    it('resolves connection id + role name — GET-by-id succeeds, no list needed', async () => {
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('dbc_1', 'app-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      // GET-by-id should be called (id-first strategy for dbc_ prefix).
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_1');
      // LIST should NOT be called since GET-by-id succeeded.
      expect(mockGet).not.toHaveBeenCalledWith('/v1/dynamic-secrets/connections');
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_1/roles');
    });

    it('falls back to list-by-name when GET-by-id 404s for a dbc_ target', async () => {
      // The dbc_ prefix triggers id-first strategy. When GET-by-id 404s,
      // the resolver falls back to listing and matching by name.
      // Set up: a connection whose NAME is 'dbc_alias' (contrived but valid) lives in the list.
      const connWithDbc: DbConnection = { ...CONNECTION, id: 'dbc_2', name: 'dbc_alias' };
      setupClientGet([ROLE_RW], {
        getByIdFails: true,
        connectionList: [connWithDbc],
      });

      const result = await resolveTarget('dbc_alias', 'app-rw');

      // Should have resolved via list fallback (name='dbc_alias' found in list).
      expect(result).toEqual({ connectionId: 'dbc_2', roleId: 'dbr_rw' });
      // GET-by-id tried first (dbc_ prefix).
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_alias');
      // List called as fallback.
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections');
    });
  });

  describe('explicit connection by name (BUG-2 regression guard)', () => {
    it('resolves a friendly connection name + role name to ids (list-first path)', async () => {
      // GET-by-id will 404 for 'staging-mysql' (it's not an id). Since the target
      // does NOT start with 'dbc_', we list-first. The list contains CONNECTION
      // with name='staging-mysql', so we find it without a GET-by-id round trip.
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-mysql', 'app-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      // List endpoint must have been called to resolve by name.
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections');
      // GET-by-id should NOT have been called (name resolved from list).
      expect(mockGet).not.toHaveBeenCalledWith('/v1/dynamic-secrets/connections/staging-mysql');
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_1/roles');
    });

    it('resolves connection name + role id', async () => {
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

    it('throws "not found (by id or name)" when name is not in the list', async () => {
      setupClientGet([ROLE_RW], {
        connectionList: [], // empty list — name won't match
      });

      // The id-fallback GET will also fail since getByIdFails defaults to false,
      // but the list is empty so list-by-name fails. The id-fallback GET will
      // succeed (returns CONNECTION by default). Let's use getByIdFails=true to
      // exercise the full not-found path.
      setupClientGet([ROLE_RW], {
        connectionList: [],
        getByIdFails: true,
      });

      await expect(resolveTarget('ghost-mysql', 'app-rw')).rejects.toThrow(
        /not found \(by id or name\)/i,
      );
    });
  });

  describe('alias resolution', () => {
    it('expands a known alias with connection stored as name → resolves via list', async () => {
      mockGetAlias.mockReturnValue({ connection: 'staging-mysql', role: 'app-rw' });
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      expect(mockGetAlias).toHaveBeenCalledWith('staging-rw');
      // Connection resolved via list (name-first for non-dbc_ targets).
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections');
    });

    it('expands a known alias with connection stored as id → resolves via GET-by-id', async () => {
      mockGetAlias.mockReturnValue({ connection: 'dbc_1', role: 'app-rw' });
      setupClientGet([ROLE_RW, ROLE_RO]);

      const result = await resolveTarget('staging-rw');

      expect(result).toEqual({ connectionId: 'dbc_1', roleId: 'dbr_rw' });
      // Connection resolved via GET-by-id (dbc_ prefix triggers id-first).
      expect(mockGet).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/dbc_1');
    });

    it('throws a dangling-alias error when the connection no longer exists', async () => {
      mockGetAlias.mockReturnValue({ connection: 'gone-conn', role: 'app-rw' });
      // Both list and GET-by-id fail.
      mockGet.mockImplementation((url: string): Promise<never> => {
        if (url === '/v1/dynamic-secrets/connections') {
          return Promise.resolve([] as unknown as never); // empty list
        }
        return Promise.reject(new Error('Not found'));
      });

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
