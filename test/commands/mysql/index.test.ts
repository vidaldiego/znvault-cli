// test/commands/mysql/index.test.ts
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerMysqlCommands } from '../../../src/commands/mysql/index.js';

describe('mysql command registration', () => {
  it('registers exec, connect, alias subcommands', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    expect(mysql).toBeDefined();
    const names = mysql!.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['exec', 'connect', 'alias']));
  });

  it('mysql alias has add, list, rm subcommands', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const alias = mysql!.commands.find((c) => c.name() === 'alias');
    expect(alias).toBeDefined();
    const aliasNames = alias!.commands.map((c) => c.name());
    expect(aliasNames).toEqual(expect.arrayContaining(['add', 'list', 'rm']));
  });

  it('mysql exec has --role, --file, --sql, --ttl, --database options', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const exec = mysql!.commands.find((c) => c.name() === 'exec');
    expect(exec).toBeDefined();
    const optNames = exec!.options.map((o) => o.long);
    expect(optNames).toEqual(expect.arrayContaining(['--role', '--file', '--sql', '--ttl', '--database']));
  });

  it('mysql connect has --role, --ttl, --database options', () => {
    const p = new Command().enablePositionalOptions();
    registerMysqlCommands(p);
    const mysql = p.commands.find((c) => c.name() === 'mysql');
    const connect = mysql!.commands.find((c) => c.name() === 'connect');
    expect(connect).toBeDefined();
    const optNames = connect!.options.map((o) => o.long);
    expect(optNames).toEqual(expect.arrayContaining(['--role', '--ttl', '--database']));
  });
});
