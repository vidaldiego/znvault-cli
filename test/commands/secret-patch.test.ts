// Path: test/commands/secret-patch.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// ============================================================================
// Unit Tests for Patch Operations
// ============================================================================

describe('patch operations', () => {
  describe('parsePath', () => {
    it('should parse simple key path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('key');
      expect(result.segments).toEqual([{ type: 'key', key: 'key' }]);
    });

    it('should parse nested dot-notation path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('a.b.c');
      expect(result.segments).toEqual([
        { type: 'key', key: 'a' },
        { type: 'key', key: 'b' },
        { type: 'key', key: 'c' },
      ]);
    });

    it('should parse array index path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('arr[0]');
      expect(result.segments).toEqual([
        { type: 'key', key: 'arr' },
        { type: 'index', index: 0 },
      ]);
    });

    it('should parse array append path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('arr[+]');
      expect(result.segments).toEqual([
        { type: 'key', key: 'arr' },
        { type: 'append' },
      ]);
    });

    it('should parse mixed path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('a.b[0].c');
      expect(result.segments).toEqual([
        { type: 'key', key: 'a' },
        { type: 'key', key: 'b' },
        { type: 'index', index: 0 },
        { type: 'key', key: 'c' },
      ]);
    });

    it('should parse deep nested array path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      const result = parsePath('servers[0].config.ports[1]');
      expect(result.segments).toEqual([
        { type: 'key', key: 'servers' },
        { type: 'index', index: 0 },
        { type: 'key', key: 'config' },
        { type: 'key', key: 'ports' },
        { type: 'index', index: 1 },
      ]);
    });

    it('should throw on empty path', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      expect(() => parsePath('')).toThrow();
    });

    it('should throw on unclosed bracket', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      expect(() => parsePath('arr[0')).toThrow('Unclosed bracket');
    });

    it('should throw on invalid array index', async () => {
      const { parsePath } = await import('../../src/commands/secret/patch/operations.js');

      expect(() => parsePath('arr[abc]')).toThrow('Invalid array index');
    });
  });

  describe('inferValueType', () => {
    it('should convert "true" to boolean true', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('true')).toBe(true);
    });

    it('should convert "false" to boolean false', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('false')).toBe(false);
    });

    it('should convert "null" to null', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('null')).toBe(null);
    });

    it('should convert integer strings to numbers', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('123')).toBe(123);
      expect(inferValueType('-42')).toBe(-42);
      expect(inferValueType('0')).toBe(0);
    });

    it('should convert float strings to numbers', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('3.14')).toBe(3.14);
      expect(inferValueType('-0.5')).toBe(-0.5);
    });

    it('should keep other strings as strings', async () => {
      const { inferValueType } = await import('../../src/commands/secret/patch/operations.js');

      expect(inferValueType('hello')).toBe('hello');
      expect(inferValueType('True')).toBe('True'); // case sensitive
      expect(inferValueType('')).toBe('');
    });
  });

  describe('parseValue', () => {
    it('should parse JSON objects', async () => {
      const { parseValue } = await import('../../src/commands/secret/patch/operations.js');

      expect(parseValue('{"key": "value"}')).toEqual({ key: 'value' });
    });

    it('should parse JSON arrays', async () => {
      const { parseValue } = await import('../../src/commands/secret/patch/operations.js');

      expect(parseValue('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('should fall back to type inference for non-JSON', async () => {
      const { parseValue } = await import('../../src/commands/secret/patch/operations.js');

      expect(parseValue('true')).toBe(true);
      expect(parseValue('123')).toBe(123);
      expect(parseValue('hello')).toBe('hello');
    });

    it('should return invalid JSON as string', async () => {
      const { parseValue } = await import('../../src/commands/secret/patch/operations.js');

      expect(parseValue('{invalid}')).toBe('{invalid}');
    });
  });

  describe('setAtPath', () => {
    it('should set top-level key', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { existing: 'value' };
      const path = parsePath('newKey');
      setAtPath(obj, path, 'newValue');

      expect(obj).toEqual({ existing: 'value', newKey: 'newValue' });
    });

    it('should set nested key, creating intermediate objects', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj: Record<string, unknown> = {};
      const path = parsePath('a.b.c');
      setAtPath(obj, path, 'value');

      expect(obj).toEqual({ a: { b: { c: 'value' } } });
    });

    it('should set array index, creating intermediate arrays', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj: Record<string, unknown> = {};
      const path = parsePath('arr[0]');
      setAtPath(obj, path, 'first');

      expect(obj).toEqual({ arr: ['first'] });
    });

    it('should append to array with [+]', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj: Record<string, unknown> = { arr: ['a', 'b'] };
      const path = parsePath('arr[+]');
      setAtPath(obj, path, 'c');

      expect(obj).toEqual({ arr: ['a', 'b', 'c'] });
    });

    it('should return previous value', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { key: 'old' };
      const path = parsePath('key');
      const prev = setAtPath(obj, path, 'new');

      expect(prev).toBe('old');
      expect(obj.key).toBe('new');
    });

    it('should handle mixed paths', async () => {
      const { parsePath, setAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj: Record<string, unknown> = { servers: [{ name: 'server1' }] };
      const path = parsePath('servers[0].config.port');
      setAtPath(obj, path, 8080);

      expect(obj).toEqual({
        servers: [{ name: 'server1', config: { port: 8080 } }],
      });
    });
  });

  describe('unsetAtPath', () => {
    it('should remove top-level key', async () => {
      const { parsePath, unsetAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { a: 1, b: 2 };
      const path = parsePath('a');
      const removed = unsetAtPath(obj, path);

      expect(removed).toBe(1);
      expect(obj).toEqual({ b: 2 });
    });

    it('should remove nested key', async () => {
      const { parsePath, unsetAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { outer: { inner: 'value', other: 'keep' } };
      const path = parsePath('outer.inner');
      unsetAtPath(obj, path);

      expect(obj).toEqual({ outer: { other: 'keep' } });
    });

    it('should remove array element by index', async () => {
      const { parsePath, unsetAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { arr: ['a', 'b', 'c'] };
      const path = parsePath('arr[1]');
      const removed = unsetAtPath(obj, path);

      expect(removed).toBe('b');
      expect(obj).toEqual({ arr: ['a', 'c'] });
    });

    it('should return undefined for non-existent path', async () => {
      const { parsePath, unsetAtPath } = await import('../../src/commands/secret/patch/operations.js');

      const obj = { a: 1 };
      const path = parsePath('b.c.d');
      const removed = unsetAtPath(obj, path);

      expect(removed).toBeUndefined();
      expect(obj).toEqual({ a: 1 });
    });
  });

  describe('parseSetArgs', () => {
    it('should parse simple key=value', async () => {
      const { parseSetArgs } = await import('../../src/commands/secret/patch/operations.js');

      const ops = parseSetArgs(['key=value']);
      expect(ops).toEqual([{ type: 'set', path: 'key', value: 'value' }]);
    });

    it('should parse multiple args', async () => {
      const { parseSetArgs } = await import('../../src/commands/secret/patch/operations.js');

      const ops = parseSetArgs(['a=1', 'b=true', 'c.d=test']);
      expect(ops).toHaveLength(3);
      expect(ops[0]).toEqual({ type: 'set', path: 'a', value: 1 });
      expect(ops[1]).toEqual({ type: 'set', path: 'b', value: true });
      expect(ops[2]).toEqual({ type: 'set', path: 'c.d', value: 'test' });
    });

    it('should handle values with = in them', async () => {
      const { parseSetArgs } = await import('../../src/commands/secret/patch/operations.js');

      const ops = parseSetArgs(['url=https://example.com?a=1&b=2']);
      expect(ops[0].value).toBe('https://example.com?a=1&b=2');
    });

    it('should throw on missing =', async () => {
      const { parseSetArgs } = await import('../../src/commands/secret/patch/operations.js');

      expect(() => parseSetArgs(['invalid'])).toThrow('expected path=value');
    });
  });
});

// ============================================================================
// Unit Tests for Parsers
// ============================================================================

describe('patch parsers', () => {
  describe('JSON parser', () => {
    it('should parse valid JSON', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('json');
      const result = parser.parse('{"key": "value", "num": 42}');

      expect(result).toEqual({ key: 'value', num: 42 });
    });

    it('should stringify JSON with indentation', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('json');
      const result = parser.stringify({ a: 1, b: 2 });

      expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });

    it('should throw on invalid JSON', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('json');
      expect(() => parser.parse('{invalid}')).toThrow('Invalid JSON');
    });

    it('should throw on non-object JSON', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('json');
      expect(() => parser.parse('"string"')).toThrow('must be an object');
      expect(() => parser.parse('[1, 2, 3]')).toThrow('must be an object');
    });
  });

  describe('YAML parser', () => {
    it('should parse valid YAML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('yaml');
      const result = parser.parse('key: value\nnum: 42');

      expect(result).toEqual({ key: 'value', num: 42 });
    });

    it('should parse nested YAML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('yaml');
      const result = parser.parse(`
database:
  host: localhost
  port: 5432
`);

      expect(result).toEqual({
        database: { host: 'localhost', port: 5432 },
      });
    });

    it('should stringify YAML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('yaml');
      const result = parser.stringify({ key: 'value' });

      expect(result.trim()).toBe('key: value');
    });
  });

  describe('ENV parser', () => {
    it('should parse simple env vars', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('env');
      const result = parser.parse('KEY=value\nOTHER=123');

      expect(result).toEqual({ KEY: 'value', OTHER: '123' });
    });

    it('should handle quoted values', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('env');
      const result = parser.parse('KEY="value with spaces"\nOTHER=\'single quoted\'');

      expect(result).toEqual({
        KEY: 'value with spaces',
        OTHER: 'single quoted',
      });
    });

    it('should skip comments and empty lines', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('env');
      const result = parser.parse(`
# Comment
KEY=value

# Another comment
OTHER=test
`);

      expect(result).toEqual({ KEY: 'value', OTHER: 'test' });
    });

    it('should stringify env vars', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('env');
      const result = parser.stringify({ KEY: 'value', OTHER: 'test' });

      expect(result).toBe('KEY=value\nOTHER=test');
    });

    it('should quote values with special characters', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('env');
      const result = parser.stringify({ KEY: 'value with spaces' });

      expect(result).toBe('KEY="value with spaces"');
    });
  });

  describe('properties parser', () => {
    it('should parse simple properties', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('properties');
      const result = parser.parse('key=value\nother=test');

      expect(result).toEqual({ key: 'value', other: 'test' });
    });

    it('should handle colon separator', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('properties');
      const result = parser.parse('key: value');

      expect(result).toEqual({ key: 'value' });
    });

    it('should skip comments', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('properties');
      const result = parser.parse(`
# Comment
key=value
! Another comment
other=test
`);

      expect(result).toEqual({ key: 'value', other: 'test' });
    });

    it('should stringify properties', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('properties');
      const result = parser.stringify({ key: 'value' });

      expect(result).toBe('key=value');
    });
  });

  describe('TOML parser', () => {
    it('should parse simple TOML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('toml');
      const result = parser.parse('key = "value"\nnum = 42');

      expect(result).toEqual({ key: 'value', num: 42 });
    });

    it('should parse TOML sections', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('toml');
      const result = parser.parse(`
[database]
host = "localhost"
port = 5432
`);

      expect(result).toEqual({
        database: { host: 'localhost', port: 5432 },
      });
    });

    it('should stringify TOML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('toml');
      const result = parser.stringify({ key: 'value' });

      expect(result.trim()).toBe('key = "value"');
    });

    it('should throw on invalid TOML', async () => {
      const { getParser } = await import('../../src/commands/secret/patch/parsers.js');

      const parser = getParser('toml');
      expect(() => parser.parse('invalid [')).toThrow('Invalid TOML');
    });
  });
});

// ============================================================================
// Unit Tests for Format Detection
// ============================================================================

describe('format detection', () => {
  describe('detectFormatFromMetadata', () => {
    it('should detect from subType', async () => {
      const { detectFormatFromMetadata } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromMetadata(undefined, 'json')).toBe('json');
      expect(detectFormatFromMetadata(undefined, 'yaml')).toBe('yaml');
      expect(detectFormatFromMetadata(undefined, 'yml')).toBe('yaml');
      expect(detectFormatFromMetadata(undefined, 'env')).toBe('env');
      expect(detectFormatFromMetadata(undefined, 'dotenv')).toBe('env');
      expect(detectFormatFromMetadata(undefined, 'properties')).toBe('properties');
      expect(detectFormatFromMetadata(undefined, 'toml')).toBe('toml');
    });

    it('should detect from contentType', async () => {
      const { detectFormatFromMetadata } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromMetadata('application/json')).toBe('json');
      expect(detectFormatFromMetadata('text/yaml')).toBe('yaml');
      expect(detectFormatFromMetadata('application/toml')).toBe('toml');
    });

    it('should return undefined for unknown types', async () => {
      const { detectFormatFromMetadata } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromMetadata(undefined, undefined)).toBeUndefined();
      expect(detectFormatFromMetadata('text/plain', 'unknown')).toBeUndefined();
    });
  });

  describe('detectFormatFromContent', () => {
    it('should detect JSON from content', async () => {
      const { detectFormatFromContent } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromContent('{"key": "value"}')).toBe('json');
      expect(detectFormatFromContent('  { "a": 1 }  ')).toBe('json');
    });

    it('should detect env format from content', async () => {
      const { detectFormatFromContent } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromContent('DATABASE_URL=postgres://\nAPI_KEY=secret')).toBe('env');
    });

    it('should detect TOML from content', async () => {
      const { detectFormatFromContent } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromContent('[database]\nhost = "localhost"')).toBe('toml');
    });

    it('should detect YAML from content', async () => {
      const { detectFormatFromContent } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormatFromContent('---\nkey: value')).toBe('yaml');
    });
  });

  describe('detectFormat', () => {
    it('should prioritize explicit format', async () => {
      const { detectFormat } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormat('{"key": "value"}', 'yaml')).toBe('yaml');
    });

    it('should use metadata when no explicit format', async () => {
      const { detectFormat } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormat('{"key": "value"}', undefined, 'text/yaml')).toBe('yaml');
    });

    it('should fall back to content heuristics', async () => {
      const { detectFormat } = await import('../../src/commands/secret/patch/parsers.js');

      expect(detectFormat('{"key": "value"}')).toBe('json');
    });
  });
});

// ============================================================================
// Unit Tests for Diff Generation
// ============================================================================

describe('diff generation', () => {
  it('should generate diff for add operations', async () => {
    const { generateDiff } = await import('../../src/commands/secret/patch/diff.js');

    const diff = generateDiff(
      '{"a": 1}',
      '{"a": 1, "b": 2}',
      [{ type: 'set', path: 'b', newValue: 2 }]
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toEqual({ type: 'add', path: 'b', newValue: 2 });
  });

  it('should generate diff for modify operations', async () => {
    const { generateDiff } = await import('../../src/commands/secret/patch/diff.js');

    const diff = generateDiff(
      '{"a": 1}',
      '{"a": 2}',
      [{ type: 'set', path: 'a', previousValue: 1, newValue: 2 }]
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toEqual({
      type: 'modify',
      path: 'a',
      oldValue: 1,
      newValue: 2,
    });
  });

  it('should generate diff for remove operations', async () => {
    const { generateDiff } = await import('../../src/commands/secret/patch/diff.js');

    const diff = generateDiff(
      '{"a": 1, "b": 2}',
      '{"a": 1}',
      [{ type: 'unset', path: 'b', previousValue: 2 }]
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toEqual({ type: 'remove', path: 'b', oldValue: 2 });
  });
});

// ============================================================================
// Integration Tests for Patch Command
// ============================================================================

describe('secret patch command', () => {
  const mockSecretMetadata = {
    id: 'secret-1',
    alias: 'config/app',
    tenant: 'acme',
    type: 'setting',
    subType: 'json',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockDecryptedSecret = {
    ...mockSecretMetadata,
    data: {
      version: '1.0',
      database: { host: 'localhost', port: 5432 },
    },
  };

  beforeEach(() => {
    vi.resetModules();

    // Mock client
    vi.doMock('../../src/lib/client.js', () => ({
      client: {
        get: vi.fn().mockResolvedValue(mockSecretMetadata),
        post: vi.fn().mockResolvedValue(mockDecryptedSecret),
        put: vi.fn().mockResolvedValue({ ...mockSecretMetadata, version: 2 }),
        configure: vi.fn(),
      },
    }));

    // Mock config
    vi.doMock('../../src/lib/config.js', () => ({
      getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
      getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
    }));

    // Mock output
    vi.doMock('../../src/lib/output.js', () => ({
      spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      json: vi.fn(),
    }));

    // Mock output-mode
    vi.doMock('../../src/lib/output-mode.js', () => ({
      isPlainMode: vi.fn().mockReturnValue(true),
      isQuietMode: vi.fn().mockReturnValue(false),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should patch a secret with --set', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node', 'test', 'secret', 'patch', 'config/app',
      '--set', 'version=2.0',
    ]);

    const { client } = await import('../../src/lib/client.js');
    const { success } = await import('../../src/lib/output.js');

    expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt', {});
    // Note: "2.0" is inferred as a number (2) by the value type inference
    expect(client.put).toHaveBeenCalledWith('/v1/secrets/secret-1', expect.objectContaining({
      data: expect.objectContaining({ version: 2 }),
    }));
    expect(success).toHaveBeenCalledWith('Secret patched successfully!');

    consoleSpy.mockRestore();
  });

  it('should patch a secret with --unset', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node', 'test', 'secret', 'patch', 'config/app',
      '--unset', 'version',
    ]);

    const { client } = await import('../../src/lib/client.js');

    expect(client.put).toHaveBeenCalledWith('/v1/secrets/secret-1', expect.objectContaining({
      data: expect.not.objectContaining({ version: expect.anything() }),
    }));

    consoleSpy.mockRestore();
  });

  it('should handle --dry-run flag', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node', 'test', 'secret', 'patch', 'config/app',
      '--set', 'version=2.0',
      '--dry-run',
    ]);

    const { client } = await import('../../src/lib/client.js');
    const { info } = await import('../../src/lib/output.js');

    // Should fetch secret but NOT update
    expect(client.post).toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Dry-run mode - no changes will be applied');

    consoleSpy.mockRestore();
  });

  it('should output JSON with --json flag', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node', 'test', 'secret', 'patch', 'config/app',
      '--set', 'version=2.0',
      '--json',
    ]);

    const { json } = await import('../../src/lib/output.js');

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      version: 2,
      format: 'json',
    }));

    consoleSpy.mockRestore();
  });

  it('should require at least one --set or --unset', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(
      program.parseAsync(['node', 'test', 'secret', 'patch', 'config/app'])
    ).rejects.toThrow('process.exit');

    const { error } = await import('../../src/lib/output.js');
    expect(error).toHaveBeenCalledWith('At least one --set or --unset option is required');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should handle nested path operations', async () => {
    const program = new Command();
    program.exitOverride();

    const { registerSecretCommands } = await import('../../src/commands/secret/index.js');
    registerSecretCommands(program);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node', 'test', 'secret', 'patch', 'config/app',
      '--set', 'database.host=db.prod.example.com',
      '--set', 'database.port=5433',
    ]);

    const { client } = await import('../../src/lib/client.js');

    expect(client.put).toHaveBeenCalledWith('/v1/secrets/secret-1', expect.objectContaining({
      data: expect.objectContaining({
        database: expect.objectContaining({
          host: 'db.prod.example.com',
          port: 5433,
        }),
      }),
    }));

    consoleSpy.mockRestore();
  });
});
