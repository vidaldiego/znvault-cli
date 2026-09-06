// Path: src/commands/plugin/helpers.ts

/**
 * Plugin command helper functions
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfigPath } from '../../lib/config.js';
import { ZINCAPP_PREFIX } from './types.js';
import { createDebugLogger } from '../../lib/debug.js';

const log = createDebugLogger('plugin-helpers');

/**
 * Get the plugins directory path (alongside config.json)
 */
export function getPluginsDir(): string {
  const configPath = getConfigPath();
  return join(dirname(configPath), 'plugins');
}

/**
 * Ensure plugins directory exists with package.json
 */
export function ensurePluginsDir(): string {
  const pluginsDir = getPluginsDir();

  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  const packageJsonPath = join(pluginsDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    writeFileSync(packageJsonPath, JSON.stringify({
      name: 'znvault-plugins',
      version: '1.0.0',
      private: true,
      description: 'ZNVault CLI plugins',
      type: 'module',
    }, null, 2));
  }

  return pluginsDir;
}

/**
 * Resolve plugin name to full package name
 * - "payara" -> "@zincapp/znvault-plugin-payara"
 * - "@zincapp/znvault-plugin-payara" -> "@zincapp/znvault-plugin-payara"
 * - "@other/plugin" -> "@other/plugin"
 */
export function resolvePluginName(name: string): string {
  // Already a scoped or full package name
  if (name.startsWith('@') || name.includes('/')) {
    return name;
  }

  // Check if it's a simple name, prepend ZincApp prefix
  return `${ZINCAPP_PREFIX}${name}`;
}

/**
 * Get short name from full package name
 */
export function getShortName(packageName: string): string {
  if (packageName.startsWith(ZINCAPP_PREFIX)) {
    return packageName.slice(ZINCAPP_PREFIX.length);
  }
  return packageName;
}

/**
 * Validate npm package name to prevent command injection
 * Valid: alphanumeric, hyphens, underscores, dots, @ for scopes, / for scoped packages
 */
export function isValidPackageName(name: string): boolean {
  // npm package name pattern: optional @scope/ followed by package name
  // Scoped: @scope/package-name
  // Unscoped: package-name
  const npmPackagePattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  return npmPackagePattern.test(name) && name.length <= 214;
}

/**
 * Check if a package exists on npm
 */
export function packageExists(packageName: string): boolean {
  if (!isValidPackageName(packageName)) {
    return false;
  }
  try {
    // Use execFileSync with args array to avoid shell injection
    execFileSync('npm', ['view', packageName, 'version'], { stdio: 'pipe' });
    return true;
  } catch (err) {
    log.silenced('packageExists', err);
    return false;
  }
}

/**
 * Get package version from npm
 */
export function getPackageVersion(packageName: string): string | null {
  if (!isValidPackageName(packageName)) {
    return null;
  }
  try {
    // Use execFileSync with args array to avoid shell injection
    const result = execFileSync('npm', ['view', packageName, 'version'], { stdio: 'pipe' });
    return result.toString().trim();
  } catch (err) {
    log.silenced('getPackageVersion', err);
    return null;
  }
}

/**
 * Get installed package version
 */
export function getInstalledVersion(packageName: string, pluginsDir: string): string | null {
  try {
    const packageJsonPath = join(pluginsDir, 'node_modules', packageName, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
      return pkg.version ?? null;
    }
  } catch (err) {
    log.silenced('getInstalledVersion', err);
  }
  return null;
}

interface ParsedVersion {
  core: [bigint, bigint, bigint];
  prerelease: string[] | null;
}

function parseVersion(version: string): ParsedVersion | null {
  const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const match = versionPattern.exec(version);
  if (!match) return null;
  const prerelease = match.at(4);

  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: prerelease ? prerelease.split('.') : null,
  };
}

function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a.at(i);
    const right = b.at(i);
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      return BigInt(left) > BigInt(right) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

/** Return true only when candidate has higher SemVer precedence than current. */
export function isVersionNewer(candidate: string, current: string): boolean {
  const parsedCandidate = parseVersion(candidate);
  const parsedCurrent = parseVersion(current);
  if (!parsedCandidate || !parsedCurrent) return false;

  for (let i = 0; i < parsedCandidate.core.length; i++) {
    if (parsedCandidate.core[i] > parsedCurrent.core[i]) return true;
    if (parsedCandidate.core[i] < parsedCurrent.core[i]) return false;
  }
  return comparePrerelease(parsedCandidate.prerelease, parsedCurrent.prerelease) > 0;
}

/**
 * Run npm command in plugins directory
 */
export function runNpm(args: string[], pluginsDir: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const npm = spawn('npm', args, {
      cwd: pluginsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    npm.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    npm.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    npm.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout + stderr,
      });
    });

    npm.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
      });
    });
  });
}

/**
 * Validate that a package is a valid znvault CLI plugin
 */
export function validatePlugin(packageName: string, pluginsDir: string): { valid: boolean; error?: string } {
  try {
    const packageJsonPath = join(pluginsDir, 'node_modules', packageName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return { valid: false, error: 'Package not found after installation' };
    }

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      exports?: Record<string, string | { import?: string }>;
      main?: string;
    };

    // Check for CLI plugin export
    const hasCliExport = pkg.exports?.['./cli'] !== undefined || pkg.main !== undefined;
    if (!hasCliExport) {
      return { valid: false, error: 'Package does not export a CLI plugin' };
    }

    // Try to dynamically import and validate
    try {
      const modulePath = join(pluginsDir, 'node_modules', packageName);
      const cliExport = pkg.exports?.['./cli'];
      const cliPath = typeof cliExport === 'object' ? cliExport.import : cliExport;
      const resolvedCliPath = cliPath ?? './dist/cli.js';
      const fullPath = join(modulePath, resolvedCliPath);

      // Check if the CLI module exists
      if (!existsSync(fullPath.replace(/\.js$/, '.js')) && !existsSync(fullPath)) {
        // Try without ./cli export - main export might have createPayaraCLIPlugin
        const mainExport = pkg.exports?.['.'];
        const mainPath = join(modulePath, (typeof mainExport === 'object' ? mainExport.import : mainExport) ?? pkg.main ?? 'dist/index.js');
        if (!existsSync(mainPath)) {
          return { valid: false, error: 'CLI module not found' };
        }
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: `Failed to validate plugin: ${String(err)}` };
    }
  } catch (err) {
    return { valid: false, error: `Validation error: ${String(err)}` };
  }
}

/**
 * Find a plugin by name in the plugins list
 */
export function findPlugin(
  plugins: Array<{ package?: string; path?: string; enabled?: boolean }>,
  name: string
): { package?: string; path?: string; enabled?: boolean } | undefined {
  const packageName = resolvePluginName(name);
  return plugins.find(p =>
    p.package === packageName ||
    p.package === name ||
    getShortName(p.package ?? '') === name
  );
}
