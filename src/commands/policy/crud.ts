// Path: src/commands/policy/crud.ts

/**
 * Policy CRUD commands
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import { formatActiveStatus } from '../../lib/format-helpers.js';
import type { CreatePolicyInput, UpdatePolicyInput, PolicyEffect } from '../../types/index.js';
import type {
  PolicyCreateOptions,
  PolicyUpdateOptions,
  PolicyDeleteOptions,
  PolicyToggleOptions,
  PolicyValidateOptions,
} from './types.js';
import { safeReadFile, safeParseJson } from './helpers.js';

export async function createPolicy(options: PolicyCreateOptions): Promise<void> {
  try {
    let policyData: CreatePolicyInput;

    if (options.fromFile) {
      const content = safeReadFile(options.fromFile);
      policyData = safeParseJson<CreatePolicyInput>(content, options.fromFile);
    } else {
      const priority = parseInt(options.priority, 10);
      if (isNaN(priority) || priority < 0) {
        output.fatal('Priority must be a non-negative number');
      }

      policyData = {
        name: options.name,
        description: options.description,
        effect: options.effect as PolicyEffect,
        actions: options.actions.split(',').map((a: string) => a.trim()),
        priority,
        tenantId: options.tenant,
      };

      if (options.resources) {
        policyData.resources = safeParseJson<CreatePolicyInput['resources']>(options.resources, '--resources');
      }
      if (options.conditions) {
        policyData.conditions = safeParseJson<CreatePolicyInput['conditions']>(options.conditions, '--conditions');
      }
    }

    if (policyData.priority === undefined) {
      policyData.priority = 0;
    } else if (typeof policyData.priority !== 'number' || isNaN(policyData.priority) || policyData.priority < 0) {
      output.fatal('Priority must be a non-negative number');
    }

    const spinner = ora('Creating policy...').start();

    const result = await client.createPolicy(policyData);
    spinner.succeed('Policy created successfully');

    if (options.json) {
      output.json(result);
    } else {
      output.keyValue({
        'ID': result.id,
        'Name': result.name,
        'Effect': result.effect.toUpperCase(),
        'Priority': result.priority.toString(),
        'Status': formatActiveStatus(result.isActive),
      });
    }
  } catch (err) {
    output.fatal(output.getErrorMessage(err));
  }
}

export async function updatePolicy(id: string, options: PolicyUpdateOptions): Promise<void> {
  try {
    let updates: UpdatePolicyInput;

    if (options.fromFile) {
      const content = safeReadFile(options.fromFile);
      updates = safeParseJson<UpdatePolicyInput>(content, options.fromFile);
    } else {
      updates = {};
      if (options.name) updates.name = options.name;
      if (options.description) updates.description = options.description;
      if (options.effect) updates.effect = options.effect as PolicyEffect;
      if (options.actions) updates.actions = options.actions.split(',').map((a: string) => a.trim());
      if (options.priority) {
        const priority = parseInt(options.priority, 10);
        if (isNaN(priority) || priority < 0) {
          output.fatal('Priority must be a non-negative number');
        }
        updates.priority = priority;
      }
      if (options.resources) updates.resources = safeParseJson<UpdatePolicyInput['resources']>(options.resources, '--resources');
      if (options.conditions) updates.conditions = safeParseJson<UpdatePolicyInput['conditions']>(options.conditions, '--conditions');
    }

    if (Object.keys(updates).length === 0) {
      output.fatal('No updates specified');
    }

    const spinner = ora('Updating policy...').start();

    const result = await client.updatePolicy(id, updates);
    spinner.succeed('Policy updated successfully');

    if (options.json) {
      output.json(result);
    } else {
      output.keyValue({
        'ID': result.id,
        'Name': result.name,
        'Effect': result.effect.toUpperCase(),
        'Updated': output.formatDate(result.updatedAt),
      });
    }
  } catch (err) {
    output.fatal(output.getErrorMessage(err));
  }
}

export async function deletePolicy(id: string, options: PolicyDeleteOptions): Promise<void> {
  try {
    if (!options.yes) {
      const confirmed = await promptConfirm(
        `Are you sure you want to delete policy '${id}'? This cannot be undone.`
      );
      if (!confirmed) {
        output.info('Delete cancelled');
        return;
      }
    }

    const spinner = ora('Deleting policy...').start();
    await client.deletePolicy(id);
    spinner.succeed(`Policy '${id}' deleted successfully`);

    if (options.json) {
      output.json({ success: true, id, message: 'Policy deleted successfully' });
    }
  } catch (err) {
    output.fatal(output.getErrorMessage(err));
  }
}

export async function enablePolicy(id: string, options: PolicyToggleOptions): Promise<void> {
  const spinner = ora('Enabling policy...').start();

  try {
    const result = await client.togglePolicy(id, true);
    spinner.succeed('Policy enabled successfully');

    if (options.json) {
      output.json(result);
    } else {
      output.keyValue({
        'ID': result.id,
        'Name': result.name,
        'Status': 'Enabled',
      });
    }
  } catch (err) {
    spinner.fail('Failed to enable policy');
    output.fatal(output.getErrorMessage(err));
  }
}

export async function disablePolicy(id: string, options: PolicyToggleOptions): Promise<void> {
  const spinner = ora('Disabling policy...').start();

  try {
    const result = await client.togglePolicy(id, false);
    spinner.succeed('Policy disabled successfully');

    if (options.json) {
      output.json(result);
    } else {
      output.keyValue({
        'ID': result.id,
        'Name': result.name,
        'Status': 'Disabled',
      });
    }
  } catch (err) {
    spinner.fail('Failed to disable policy');
    output.fatal(output.getErrorMessage(err));
  }
}

export async function validatePolicy(options: PolicyValidateOptions): Promise<void> {
  try {
    let policyData: CreatePolicyInput;

    if (options.fromFile) {
      const content = safeReadFile(options.fromFile);
      policyData = safeParseJson<CreatePolicyInput>(content, options.fromFile);
    } else {
      const priority = parseInt(options.priority, 10);
      if (isNaN(priority) || priority < 0) {
        output.fatal('Priority must be a non-negative number');
      }

      policyData = {
        name: options.name,
        description: options.description,
        effect: options.effect as PolicyEffect,
        actions: options.actions.split(',').map((a: string) => a.trim()),
        priority,
      };

      if (options.resources) {
        policyData.resources = safeParseJson<CreatePolicyInput['resources']>(options.resources, '--resources');
      }
      if (options.conditions) {
        policyData.conditions = safeParseJson<CreatePolicyInput['conditions']>(options.conditions, '--conditions');
      }
    }

    const spinner = ora('Validating policy...').start();

    const result = await client.validatePolicy(policyData);

    if (result.valid) {
      spinner.succeed('Policy is valid');
    } else {
      spinner.fail('Policy validation failed');
      if (result.errors) {
        for (const error of result.errors) {
          output.error(`  - ${error}`);
        }
      }
      process.exit(1);
    }
  } catch (err) {
    output.fatal(output.getErrorMessage(err));
  }
}
