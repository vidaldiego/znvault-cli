import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error JS acceptance harness has no TypeScript declaration.
import { copyPreparedFixtures } from '../../scripts/recovery-artifact-fixtures.mjs';

const names = ['before-none', 'before-gzip', 'before-zstd', 'after-none', 'after-gzip', 'after-zstd'];
const scratch: string[] = [];
afterEach(() => scratch.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function prepared(cases: unknown): { source: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'recovery-fixture-set-'));
  scratch.push(root);
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'cases.json'), JSON.stringify(cases));
  writeFileSync(join(source, 'writer-material.json'), '{}');
  for (const name of names) {
    const dir = join(source, name);
    mkdirSync(dir);
    for (const file of ['expected.sql', 'input.arcn', 'key-0', 'key-1']) {
      writeFileSync(join(dir, file), `${name}/${file}`);
    }
  }
  return { source, target: join(root, 'copied') };
}

describe('prepared recovery fixture set', () => {
  it.each([
    ['duplicate valid name replacing a missing compression', ['before-none', 'before-gzip', 'before-zstd', 'after-none', 'after-gzip', 'after-gzip']],
    ['incomplete epoch/compression Cartesian product', ['before-none', 'before-gzip', 'before-zstd', 'after-none', 'after-gzip']],
  ])('rejects %s before creating or copying the destination', (_label, cases) => {
    const { source, target } = prepared(cases);
    expect(() => copyPreparedFixtures(source, target)).toThrow('Synthetic prepared fixture set required');
    expect(existsSync(target)).toBe(false);
  });

  it('copies all six distinct epoch/compression cases and preserves prepared bytes', () => {
    const { source, target } = prepared([...names].reverse());
    const result = copyPreparedFixtures(source, target) as { name: string; dir: string; plain: Buffer }[];
    expect(result.map(item => item.name)).toEqual([...names].reverse());
    for (const item of result) {
      expect(item.plain.toString()).toBe(`${item.name}/expected.sql`);
      expect(readFileSync(join(item.dir, 'input.arcn'), 'utf8')).toBe(`${item.name}/input.arcn`);
    }
  });
});
