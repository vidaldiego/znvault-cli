// Path: src/lib/client/index.ts

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types --
   Delegating facade: every member is `x = (...) => this.sub.x(...)`, so its return type IS the
   sub-client's and is inferred from it. Re-declaring it here would duplicate ~80 signatures that
   could silently drift from the ones they wrap. Non-facade code in this file still needs types. */

/**
 * VaultClient facade
 *
 * This module provides backward compatibility by exposing all client methods
 * through a single VaultClient class that delegates to domain-specific clients.
 */

import { HttpClient } from './http.js';
import { HealthClient, ClusterClient } from './health.js';
import { TenantsClient } from './tenants.js';
import { UsersClient, SuperadminsClient } from './users.js';
import { LockdownClient } from './lockdown.js';
import { AuditClient } from './audit.js';
import { ApiKeysClient } from './apikeys.js';
import { ManagedKeysClient } from './managed-keys.js';
import { PoliciesClient, PermissionsClient } from './policies.js';
import { QuarantineClient } from './quarantine.js';

import type { LoginResponse } from '../../types/index.js';

// Re-export domain clients for direct use
export { HttpClient } from './http.js';
export { HealthClient, ClusterClient } from './health.js';
export { TenantsClient } from './tenants.js';
export { UsersClient, SuperadminsClient } from './users.js';
export { LockdownClient } from './lockdown.js';
export { AuditClient } from './audit.js';
export { ApiKeysClient } from './apikeys.js';
export { ManagedKeysClient } from './managed-keys.js';
export { PoliciesClient, PermissionsClient } from './policies.js';
export { QuarantineClient } from './quarantine.js';

// Re-export types
export * from './types.js';

/**
 * VaultClient - Unified facade for all vault API operations
 *
 * This class maintains backward compatibility with the original monolithic client
 * while internally delegating to domain-specific client modules.
 */
export class VaultClient extends HttpClient {
  // Domain clients (lazy initialized)
  private _healthClient?: HealthClient;
  private _clusterClient?: ClusterClient;
  private _tenantsClient?: TenantsClient;
  private _usersClient?: UsersClient;
  private _superadminsClient?: SuperadminsClient;
  private _lockdownClient?: LockdownClient;
  private _auditClient?: AuditClient;
  private _apiKeysClient?: ApiKeysClient;
  private _managedKeysClient?: ManagedKeysClient;
  private _policiesClient?: PoliciesClient;
  private _permissionsClient?: PermissionsClient;
  private _quarantineClient?: QuarantineClient;

  // Lazy getters for domain clients
  private get healthClient(): HealthClient {
    return this._healthClient ??= new HealthClient();
  }

  private get clusterClient(): ClusterClient {
    return this._clusterClient ??= new ClusterClient();
  }

  private get tenantsClient(): TenantsClient {
    return this._tenantsClient ??= new TenantsClient();
  }

  private get usersClient(): UsersClient {
    return this._usersClient ??= new UsersClient();
  }

  private get superadminsClient(): SuperadminsClient {
    return this._superadminsClient ??= new SuperadminsClient();
  }

  private get lockdownClient(): LockdownClient {
    return this._lockdownClient ??= new LockdownClient();
  }

  private get auditClient(): AuditClient {
    return this._auditClient ??= new AuditClient();
  }

  private get apiKeysClient(): ApiKeysClient {
    return this._apiKeysClient ??= new ApiKeysClient();
  }

  private get managedKeysClient(): ManagedKeysClient {
    return this._managedKeysClient ??= new ManagedKeysClient();
  }

  private get policiesClient(): PoliciesClient {
    return this._policiesClient ??= new PoliciesClient();
  }

  private get permissionsClient(): PermissionsClient {
    return this._permissionsClient ??= new PermissionsClient();
  }

  private get quarantineClient(): QuarantineClient {
    return this._quarantineClient ??= new QuarantineClient();
  }

  // ============ Authentication (inherited from HttpClient) ============

  override async login(username: string, password: string, totp?: string): Promise<LoginResponse> {
    return super.login(username, password, totp);
  }

  // ============ Health ============

  health = () => this.healthClient.health();
  leaderHealth = () => this.healthClient.leaderHealth();

  // ============ Cluster ============

  clusterStatus = () => this.clusterClient.status();
  clusterTakeover = () => this.clusterClient.takeover();
  clusterPromote = (nodeId: string) => this.clusterClient.promote(nodeId);
  clusterRelease = () => this.clusterClient.release();
  clusterMaintenance = (enable: boolean) => this.clusterClient.maintenance(enable);

  // ============ Tenants ============

  listTenants = (options?: Parameters<TenantsClient['list']>[0]) =>
    this.tenantsClient.list(options);
  createTenant = (data: Parameters<TenantsClient['create']>[0]) =>
    this.tenantsClient.create(data);
  getTenant = (id: string, withUsage?: boolean) =>
    this.tenantsClient.getById(id, withUsage);
  updateTenant = (id: string, data: Parameters<TenantsClient['update']>[1]) =>
    this.tenantsClient.update(id, data);
  deleteTenant = (id: string) =>
    this.tenantsClient.deleteById(id);
  getTenantUsage = (id: string) =>
    this.tenantsClient.getUsage(id);

  // ============ Users ============

  listUsers = (options?: Parameters<UsersClient['list']>[0]) =>
    this.usersClient.list(options);
  createUser = (data: Parameters<UsersClient['create']>[0]) =>
    this.usersClient.create(data);
  getUser = (id: string, opts?: Parameters<UsersClient['getById']>[1]) =>
    this.usersClient.getById(id, opts);
  updateUser = (
    id: string,
    data: Parameters<UsersClient['update']>[1],
    opts?: Parameters<UsersClient['update']>[2]
  ) =>
    this.usersClient.update(id, data, opts);
  deleteUser = (id: string, opts?: Parameters<UsersClient['deleteById']>[1]) =>
    this.usersClient.deleteById(id, opts);
  unlockUser = (id: string, opts?: Parameters<UsersClient['unlock']>[1]) =>
    this.usersClient.unlock(id, opts);
  resetUserPassword = (
    id: string,
    newPassword: string,
    opts?: { asSuperadmin?: boolean }
  ) =>
    this.usersClient.resetPassword(id, newPassword, opts);
  disableUserTotp = (id: string) =>
    this.usersClient.disableTotp(id);

  // ============ Superadmins ============

  listSuperadmins = () =>
    this.superadminsClient.list();
  createSuperadmin = (data: Parameters<SuperadminsClient['create']>[0]) =>
    this.superadminsClient.create(data);
  resetSuperadminPassword = (username: string, password: string) =>
    this.superadminsClient.resetPassword(username, password);
  unlockSuperadmin = (username: string) =>
    this.superadminsClient.unlock(username);
  disableSuperadmin = (username: string) =>
    this.superadminsClient.disable(username);
  enableSuperadmin = (username: string) =>
    this.superadminsClient.enable(username);

  // ============ Lockdown ============

  getLockdownStatus = () =>
    this.lockdownClient.getStatus();
  triggerLockdown = (level: 1 | 2 | 3 | 4, reason: string) =>
    this.lockdownClient.trigger(level, reason);
  clearLockdown = (reason: string) =>
    this.lockdownClient.clear(reason);
  getLockdownHistory = (limit?: number) =>
    this.lockdownClient.getHistory(limit);
  getThreats = (options?: Parameters<LockdownClient['getThreats']>[0]) =>
    this.lockdownClient.getThreats(options);

  // ============ Audit ============

  listAudit = (options?: Parameters<AuditClient['list']>[0]) =>
    this.auditClient.list(options);
  verifyAuditChain = (opts?: Parameters<AuditClient['verifyChain']>[0]) =>
    this.auditClient.verifyChain(opts);
  exportAudit = (options?: Parameters<AuditClient['export']>[0]) =>
    this.auditClient.export(options);
  getAuditStats = (opts?: Parameters<AuditClient['getStats']>[0]) =>
    this.auditClient.getStats(opts);

  // ============ API Keys ============

  createApiKey = (data: Parameters<ApiKeysClient['create']>[0]) =>
    this.apiKeysClient.create(data);
  listApiKeys = (tenantId?: string, opts?: Parameters<ApiKeysClient['list']>[1]) =>
    this.apiKeysClient.list(tenantId, opts);
  getApiKey = (id: string, tenantId?: string, opts?: Parameters<ApiKeysClient['getById']>[2]) =>
    this.apiKeysClient.getById(id, tenantId, opts);
  deleteApiKey = (id: string, tenantId?: string, opts?: Parameters<ApiKeysClient['deleteById']>[2]) =>
    this.apiKeysClient.deleteById(id, tenantId, opts);
  rotateApiKey = (id: string, name?: string, tenantId?: string, opts?: Parameters<ApiKeysClient['rotate']>[3]) =>
    this.apiKeysClient.rotate(id, name, tenantId, opts);
  updateApiKeyPermissions = (
    id: string,
    permissions: string[],
    tenantId?: string,
    opts?: Parameters<ApiKeysClient['updatePermissions']>[3]
  ) =>
    this.apiKeysClient.updatePermissions(id, permissions, tenantId, opts);
  updateApiKeyConditions = (
    id: string,
    conditions: Record<string, unknown>,
    tenantId?: string,
    opts?: Parameters<ApiKeysClient['updateConditions']>[3]
  ) =>
    this.apiKeysClient.updateConditions(id, conditions, tenantId, opts);
  setApiKeyEnabled = (
    id: string,
    enabled: boolean,
    tenantId?: string,
    opts?: Parameters<ApiKeysClient['setEnabled']>[3]
  ) =>
    this.apiKeysClient.setEnabled(id, enabled, tenantId, opts);
  getApiKeyPolicies = (id: string, tenantId?: string, opts?: Parameters<ApiKeysClient['getPolicies']>[2]) =>
    this.apiKeysClient.getPolicies(id, tenantId, opts);
  attachApiKeyPolicy = (
    keyId: string,
    policyId: string,
    tenantId?: string,
    opts?: Parameters<ApiKeysClient['attachPolicy']>[3]
  ) =>
    this.apiKeysClient.attachPolicy(keyId, policyId, tenantId, opts);
  detachApiKeyPolicy = (
    keyId: string,
    policyId: string,
    tenantId?: string,
    opts?: Parameters<ApiKeysClient['detachPolicy']>[3]
  ) =>
    this.apiKeysClient.detachPolicy(keyId, policyId, tenantId, opts);
  getApiKeySelf = () =>
    this.apiKeysClient.getSelf();
  rotateApiKeySelf = (name?: string) =>
    this.apiKeysClient.rotateSelf(name);

  // ============ Managed API Keys ============

  createManagedApiKey = (data: Parameters<ManagedKeysClient['create']>[0]) =>
    this.managedKeysClient.create(data);
  listManagedApiKeys = (tenantId?: string, opts?: Parameters<ManagedKeysClient['list']>[1]) =>
    this.managedKeysClient.list(tenantId, opts);
  getManagedApiKey = (name: string, tenantId?: string, opts?: Parameters<ManagedKeysClient['getByName']>[2]) =>
    this.managedKeysClient.getByName(name, tenantId, opts);
  bindManagedApiKey = (name: string, tenantId?: string, opts?: Parameters<ManagedKeysClient['bind']>[2]) =>
    this.managedKeysClient.bind(name, tenantId, opts);
  rotateManagedApiKey = (name: string, tenantId?: string, opts?: Parameters<ManagedKeysClient['rotate']>[2]) =>
    this.managedKeysClient.rotate(name, tenantId, opts);
  updateManagedApiKeyConfig = (
    name: string,
    config: Parameters<ManagedKeysClient['updateConfig']>[1],
    tenantId?: string,
    opts?: Parameters<ManagedKeysClient['updateConfig']>[3]
  ) =>
    this.managedKeysClient.updateConfig(name, config, tenantId, opts);
  deleteManagedApiKey = (name: string, tenantId?: string, opts?: Parameters<ManagedKeysClient['deleteByName']>[2]) =>
    this.managedKeysClient.deleteByName(name, tenantId, opts);

  // ============ Permissions ============

  getPermissions = (category?: string) =>
    this.permissionsClient.list(category);
  validatePermissions = (permissions: string[]) =>
    this.permissionsClient.validate(permissions);

  // ============ ABAC Policies ============

  listPolicies = (options?: Parameters<PoliciesClient['list']>[0]) =>
    this.policiesClient.list(options);
  getPolicy = (id: string, tenantId?: string, opts?: Parameters<PoliciesClient['getById']>[2]) =>
    this.policiesClient.getById(id, tenantId, opts);
  createPolicy = (data: Parameters<PoliciesClient['create']>[0]) =>
    this.policiesClient.create(data);
  updatePolicy = (
    id: string,
    data: Parameters<PoliciesClient['update']>[1],
    tenantId?: string,
    opts?: Parameters<PoliciesClient['update']>[3]
  ) =>
    this.policiesClient.update(id, data, tenantId, opts);
  deletePolicy = (id: string, tenantId?: string, opts?: Parameters<PoliciesClient['deleteById']>[2]) =>
    this.policiesClient.deleteById(id, tenantId, opts);
  togglePolicy = (
    id: string,
    enabled: boolean,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['toggle']>[3]
  ) =>
    this.policiesClient.toggle(id, enabled, tenantId, opts);
  validatePolicy = (policy: Parameters<PoliciesClient['validate']>[0]) =>
    this.policiesClient.validate(policy);
  getPolicyAttachments = (
    policyId: string,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['getAttachments']>[2]
  ) =>
    this.policiesClient.getAttachments(policyId, tenantId, opts);
  attachPolicyToUser = (
    policyId: string,
    userId: string,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['attachToUser']>[3]
  ) =>
    this.policiesClient.attachToUser(policyId, userId, tenantId, opts);
  attachPolicyToRole = (
    policyId: string,
    roleId: string,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['attachToRole']>[3]
  ) =>
    this.policiesClient.attachToRole(policyId, roleId, tenantId, opts);
  detachPolicyFromUser = (
    policyId: string,
    userId: string,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['detachFromUser']>[3]
  ) =>
    this.policiesClient.detachFromUser(policyId, userId, tenantId, opts);
  detachPolicyFromRole = (
    policyId: string,
    roleId: string,
    tenantId?: string,
    opts?: Parameters<PoliciesClient['detachFromRole']>[3]
  ) =>
    this.policiesClient.detachFromRole(policyId, roleId, tenantId, opts);
  getUserPolicies = (userId: string) =>
    this.policiesClient.getUserPolicies(userId);
  getRolePolicies = (roleId: string) =>
    this.policiesClient.getRolePolicies(roleId);
  testPolicy = (request: Parameters<PoliciesClient['test']>[0]) =>
    this.policiesClient.test(request);

  // ============ IP Quarantine ============

  listQuarantines = (options?: Parameters<QuarantineClient['list']>[0]) =>
    this.quarantineClient.list(options);
  getQuarantine = (id: string, scope?: Parameters<QuarantineClient['getById']>[1]) =>
    this.quarantineClient.getById(id, scope);
  releaseQuarantine = (id: string, reason: string, scope?: Parameters<QuarantineClient['release']>[2]) =>
    this.quarantineClient.release(id, reason, scope);
  releaseQuarantineIp = (ip: string, reason: string, scope?: Parameters<QuarantineClient['releaseIp']>[2]) =>
    this.quarantineClient.releaseIp(ip, reason, scope);
  getQuarantineHistory = (ip: string, options?: Parameters<QuarantineClient['getHistory']>[1]) =>
    this.quarantineClient.getHistory(ip, options);
  getQuarantineStats = (scope?: Parameters<QuarantineClient['getStats']>[0]) =>
    this.quarantineClient.getStats(scope);
  getQuarantineConfig = (scope?: Parameters<QuarantineClient['getConfig']>[0]) =>
    this.quarantineClient.getConfig(scope);
  updateQuarantineConfig = (
    config: Parameters<QuarantineClient['updateConfig']>[0],
    scope?: Parameters<QuarantineClient['updateConfig']>[1]
  ) =>
    this.quarantineClient.updateConfig(config, scope);
}

// Export singleton instance for backward compatibility
export const client = new VaultClient();
