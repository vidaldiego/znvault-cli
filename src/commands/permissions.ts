// Path: znvault-cli/src/commands/permissions.ts
// Permissions commands - list and validate permissions from the API

import { type Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

interface Permission {
  permission: string;
  description: string;
  category: string;
}

interface PermissionsResponse {
  permissions: Permission[];
  categories: string[];
  total: number;
}

interface ValidatePermissionsResponse {
  valid: string[];
  invalid: string[];
  allValid: boolean;
}

// Command option interfaces
interface ListOptions {
  category?: string;
  json?: boolean;
}

interface CategoriesOptions {
  json?: boolean;
}

interface ValidateOptions {
  json?: boolean;
}

interface SearchOptions {
  json?: boolean;
}

export function registerPermissionsCommands(program: Command): void {
  const perms = program
    .command('permissions')
    .alias('perm')
    .description('Manage and view available permissions');

  // List permissions
  perms
    .command('list')
    .description('List all available permissions')
    .option('-c, --category <category>', 'Filter by category')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching permissions...').start();

      try {
        const result = await client.getPermissions(options.category) as PermissionsResponse;
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        console.log();
        console.log(chalk.bold(`Available Permissions (${result.total} total)`));
        console.log();

        // Group by category for display
        const byCategory = new Map<string, Permission[]>();
        for (const perm of result.permissions) {
          const list = byCategory.get(perm.category) ?? [];
          list.push(perm);
          byCategory.set(perm.category, list);
        }

        // Display sorted by category
        const sortedCategories = [...byCategory.keys()].sort();
        for (const category of sortedCategories) {
          const categoryPerms = byCategory.get(category) ?? [];
          console.log(chalk.cyan.bold(`  ${category.toUpperCase()}`));
          for (const perm of categoryPerms) {
            const desc = perm.description ? chalk.gray(` - ${perm.description}`) : '';
            console.log(`    ${chalk.white(perm.permission)}${desc}`);
          }
          console.log();
        }
      } catch (err) {
        spinner.fail('Failed to fetch permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // List categories
  perms
    .command('categories')
    .description('List permission categories')
    .option('--json', 'Output as JSON')
    .action(async (options: CategoriesOptions) => {
      const spinner = ora('Fetching categories...').start();

      try {
        const result = await client.getPermissions() as PermissionsResponse;
        spinner.stop();

        if (options.json) {
          output.json({ categories: result.categories });
          return;
        }

        console.log();
        console.log(chalk.bold('Permission Categories'));
        console.log();
        for (const category of result.categories) {
          console.log(`  ${chalk.cyan(category)}`);
        }
        console.log();
      } catch (err) {
        spinner.fail('Failed to fetch categories');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Validate permissions
  perms
    .command('validate <permissions...>')
    .description('Validate permission IDs')
    .option('--json', 'Output as JSON')
    .action(async (permissions: string[], options: ValidateOptions) => {
      const spinner = ora('Validating permissions...').start();

      try {
        const result = await client.validatePermissions(permissions) as ValidatePermissionsResponse;
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        console.log();
        if (result.allValid) {
          console.log(chalk.green.bold('All permissions are valid'));
        } else {
          console.log(chalk.red.bold('Some permissions are invalid'));
        }
        console.log();

        if (result.valid.length > 0) {
          console.log(chalk.green('Valid:'));
          for (const perm of result.valid) {
            console.log(`  ${perm}`);
          }
        }

        if (result.invalid.length > 0) {
          console.log();
          console.log(chalk.red('Invalid:'));
          for (const perm of result.invalid) {
            console.log(`  ${perm}`);
          }
        }
        console.log();

        if (!result.allValid) {
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Failed to validate permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Search permissions
  perms
    .command('search <query>')
    .description('Search permissions by name or description')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options: SearchOptions) => {
      const spinner = ora('Searching permissions...').start();

      try {
        const result = await client.getPermissions() as PermissionsResponse;
        spinner.stop();

        const searchLower = query.toLowerCase();
        const matches = result.permissions.filter(
          (p) =>
            p.permission.toLowerCase().includes(searchLower) ||
            p.description.toLowerCase().includes(searchLower) ||
            p.category.toLowerCase().includes(searchLower)
        );

        if (options.json) {
          output.json({ permissions: matches, total: matches.length });
          return;
        }

        console.log();
        if (matches.length === 0) {
          console.log(chalk.yellow(`No permissions found matching "${query}"`));
        } else {
          console.log(chalk.bold(`Found ${matches.length} permission(s) matching "${query}":`));
          console.log();
          for (const perm of matches) {
            const desc = perm.description ? chalk.gray(` - ${perm.description}`) : '';
            console.log(`  ${chalk.cyan(perm.category)}/${chalk.white(perm.permission)}${desc}`);
          }
        }
        console.log();
      } catch (err) {
        spinner.fail('Failed to search permissions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
