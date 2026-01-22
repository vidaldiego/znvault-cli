// Path: src/commands/policy/test.ts

/**
 * Policy test command
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { PolicyTestOptions } from './types.js';

export async function testPolicy(options: PolicyTestOptions): Promise<void> {
  const spinner = ora('Testing policy evaluation...').start();

  try {
    const request = {
      userId: options.user,
      action: options.action,
      resource: options.resourceType ? {
        type: options.resourceType,
        id: options.resourceId,
        tenantId: options.resourceTenant,
      } : undefined,
      requestContext: (options.ip !== undefined || options.mfa !== undefined) ? {
        ip: options.ip,
        mfaVerified: options.mfa ?? false,
      } : undefined,
    };

    const result = await client.testPolicy(request);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    const statusIcon = result.allowed ? '[OK]' : '[X]';
    const statusText = result.allowed ? 'ALLOWED' : 'DENIED';
    console.log();
    console.log(`  ${statusIcon} Access: ${statusText}`);
    console.log(`    Effect: ${result.effect.toUpperCase()}`);
    console.log(`    Reason: ${result.reason}`);
    console.log();

    output.keyValue({
      'Policies Evaluated': result.evaluatedPolicies.toString(),
      'Policies Matched': result.matchedPolicies.length.toString(),
      'Evaluation Time': `${result.evaluationTimeMs}ms`,
    });

    if (result.matchedPolicies.length > 0) {
      console.log();
      output.section('Matched Policies');
      output.table(
        ['Name', 'Effect', 'Priority'],
        result.matchedPolicies.map(p => [
          p.name,
          p.effect.toUpperCase(),
          p.priority.toString(),
        ])
      );
    }
  } catch (err) {
    spinner.fail('Failed to test policy');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
