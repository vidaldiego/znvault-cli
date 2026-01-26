// Path: src/commands/policy/io.ts

/**
 * Policy import/export commands
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { formatActiveStatus } from '../../lib/format-helpers.js';
import type { CreatePolicyInput } from '../../types/index.js';
import type { PolicyExportOptions, PolicyImportOptions } from './types.js';
import { safeReadFile, safeParseJson, safeWriteFile } from './helpers.js';

export async function exportPolicy(id: string, options: PolicyExportOptions): Promise<void> {
  const spinner = ora('Exporting policy...').start();

  try {
    const result = await client.getPolicy(id);
    spinner.stop();

    const exportData = {
      name: result.name,
      description: result.description,
      effect: result.effect,
      actions: result.actions,
      resources: result.resources,
      conditions: result.conditions,
      priority: result.priority,
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    if (options.output) {
      safeWriteFile(options.output, jsonString);
      output.success(`Policy exported to ${options.output}`);
    } else {
      console.log(jsonString);
    }
  } catch (err) {
    spinner.fail('Failed to export policy');
    output.fatal(output.getErrorMessage(err));
  }
}

export async function importPolicy(path: string, options: PolicyImportOptions): Promise<void> {
  try {
    const content = safeReadFile(path);
    const policyData = safeParseJson<CreatePolicyInput>(content, path);

    if (options.tenant) {
      policyData.tenantId = options.tenant;
    }

    const spinner = ora('Importing policy...').start();

    const result = await client.createPolicy(policyData);
    spinner.succeed('Policy imported successfully');

    if (options.json) {
      output.json(result);
    } else {
      output.keyValue({
        'ID': result.id,
        'Name': result.name,
        'Effect': result.effect.toUpperCase(),
        'Status': formatActiveStatus(result.isActive),
      });
    }
  } catch (err) {
    output.fatal(output.getErrorMessage(err));
  }
}
