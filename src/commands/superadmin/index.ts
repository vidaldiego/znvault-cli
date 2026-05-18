// Path: src/commands/superadmin/index.ts

/**
 * Superadmin command group — entry point for v4.
 *
 * The `superadmin` group hosts:
 *   - `accounts` subgroup with the original superadmin-account-management
 *     commands (list/create/reset-password/unlock/disable/enable).
 *   - Pure-superadmin groups moved here entirely:
 *       tenant, cluster, lockdown, lmk, backup.
 *   - Cross-tenant mirrors of dual-purpose groups, registered in superadmin
 *     context (--tenant accepted):
 *       advisor, agent, apikey, audit, group, host, kms, policy,
 *       quarantine, role, sso, ssh, user.
 *
 * Pure-tenant groups (e.g. secret, cert, device, dynamic-secrets, …) are NOT
 * mirrored here — they remain at the top level only.
 */

import type { Command } from 'commander';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';
import { configureContextHelp } from '../../lib/context-help.js';

import { registerAccountsCommands } from './accounts.js';

// Pure-superadmin groups (moved from top level under `superadmin`).
import { registerTenantCommands } from '../tenant.js';
import { registerClusterCommands } from '../cluster.js';
import { registerLockdownCommands } from '../lockdown.js';
import { registerLmkCommands } from '../lmk.js';
import { registerBackupCommands } from '../backup/index.js';

// Dual-purpose groups (mirrored under superadmin with --tenant).
import { registerAdvisorCommands } from '../advisor.js';
import { registerAgentCommands } from '../agent/index.js';
import { registerApiKeyCommands } from '../apikey/index.js';
import { registerAuditCommands } from '../audit.js';
import { registerGroupCommands } from '../group.js';
import { registerHostCommands } from '../host/index.js';
import { registerKmsCommands } from '../kms/index.js';
import { registerPolicyCommands } from '../policy/index.js';
import { registerQuarantineCommands } from '../quarantine.js';
import { registerRoleCommands } from '../role.js';
import { registerSSOCommands } from '../sso/index.js';
import { registerSSHCommands } from '../ssh/index.js';
import { registerUserCommands } from '../user.js';

export function registerSuperadminCommands(parent: Command, _opts?: RegisterOptions): void {
  void resolveContext(_opts);
  const superadmin = parent
    .command('superadmin')
    .description('Cross-tenant and system-level administration (superadmin only)');

  // Propagate context-aware help filtering into the superadmin namespace so
  // legacy `superadminDesc(...)` markers on nested commands keep working.
  configureContextHelp(superadmin);

  // All sub-registrations run with the superadmin context active so
  // `--tenant` options are accepted on the mirrored groups.
  withRegisterContext('superadmin', () => {
    // Superadmin account management.
    registerAccountsCommands(superadmin);

    // Pure-superadmin groups.
    registerTenantCommands(superadmin);
    registerClusterCommands(superadmin);
    registerLockdownCommands(superadmin);
    registerLmkCommands(superadmin);
    registerBackupCommands(superadmin);

    // Dual-purpose mirrors.
    registerAdvisorCommands(superadmin, { context: 'superadmin' });
    registerAgentCommands(superadmin, { context: 'superadmin' });
    registerApiKeyCommands(superadmin, { context: 'superadmin' });
    registerAuditCommands(superadmin, { context: 'superadmin' });
    registerGroupCommands(superadmin, { context: 'superadmin' });
    registerHostCommands(superadmin, { context: 'superadmin' });
    registerKmsCommands(superadmin, { context: 'superadmin' });
    registerPolicyCommands(superadmin, { context: 'superadmin' });
    registerQuarantineCommands(superadmin, { context: 'superadmin' });
    registerRoleCommands(superadmin, { context: 'superadmin' });
    registerSSOCommands(superadmin, { context: 'superadmin' });
    registerSSHCommands(superadmin, { context: 'superadmin' });
    registerUserCommands(superadmin, { context: 'superadmin' });
  });
}
