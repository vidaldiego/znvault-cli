import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { readUtf8Stream } from '../../src/lib/stdin.js';

describe('bounded stdin reader', () => {
  it('preserves UTF-8 input exactly', async () => {
    const input = Readable.from([Buffer.from('{"label":"cifrado"}\n', 'utf8')]);

    await expect(readUtf8Stream(input)).resolves.toBe('{"label":"cifrado"}\n');
  });

  it('enforces the limit in UTF-8 bytes', async () => {
    const input = Readable.from(['€€']);

    await expect(readUtf8Stream(input, 5)).rejects.toThrow('5-byte safety limit');
  });
});
