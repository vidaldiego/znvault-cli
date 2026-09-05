import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const version = readFileSync('VERSION', 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(version) ||
    pkg.version !== version || lock.version !== version ||
    lock.packages?.['']?.version !== version) {
  throw new Error('Release version mismatch: package.json, lockfile and VERSION must agree');
}
const tag = process.argv[2];
if (tag && tag !== `v${version}`) throw new Error('Tag does not match package version');
if (process.env.GITHUB_ACTIONS === 'true') {
  if (process.env.GITHUB_REF_TYPE !== 'tag' || !tag) throw new Error('Publication requires a version tag');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    throw new Error('Release tag must point to the current main commit');
  }
}
console.log(`Release metadata verified: ${version}`);
