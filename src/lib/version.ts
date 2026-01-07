// Path: znvault-cli/src/lib/version.ts

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface PackageJson {
  version?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedVersion: string | null = null;

/**
 * Get CLI version from package.json
 * Caches result for subsequent calls
 */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  const possiblePaths = [
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8')) as PackageJson;
        if (pkg.version) {
          cachedVersion = pkg.version;
          return cachedVersion;
        }
      }
    } catch {
      /* continue */
    }
  }

  cachedVersion = 'unknown';
  return cachedVersion;
}
