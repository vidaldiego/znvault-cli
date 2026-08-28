import {spawnSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {
  assertPassthroughAllowed,
  assertSafeMysqlDatabase,
} from '../../src/commands/mysql/run.js';

const enabled = process.env.ZNVAULT_REAL_MYSQL_CLIENT_SECURITY_TEST === '1';

interface ClientFixture {
  family: string;
  image: string;
  client: string;
  admin: string;
  allowEmptyPasswordEnv: string;
  familySpecificModifierBypasses: string[];
}

const fixtures: ClientFixture[] = [
  {
    family: 'Oracle MySQL 8.4',
    image: 'mysql:8.4',
    client: 'mysql',
    admin: 'mysqladmin',
    allowEmptyPasswordEnv: 'MYSQL_ALLOW_EMPTY_PASSWORD=yes',
    familySpecificModifierBypasses: [],
  },
  {
    family: 'MariaDB 11',
    image: 'mariadb:11',
    client: 'mariadb',
    admin: 'mariadb-admin',
    allowEmptyPasswordEnv: 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=yes',
    familySpecificModifierBypasses: [
      '--autoset-binary-mode=0',
      '--autoset-skip-binary-mode',
    ],
  },
];

function docker(args: string[], input?: string): ReturnType<typeof spawnSync> {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function waitUntilReady(name: string, admin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // Use TCP throughout this test. Repeated adversarial client invocations can
    // otherwise race a container-local socket disappearance/recreation even
    // though the server is ready; the production fence is transport-agnostic.
    const result = docker([
      'exec', name, admin, '--no-defaults', '-h127.0.0.1', '-uroot', 'ping',
    ]);
    if (result.status === 0) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not become ready`);
}

describe.runIf(enabled)('real mysql clients — binary-mode local-command fence', () => {
  for (const fixture of fixtures) {
    it(`${fixture.family} blocks \\! and system while retaining DELIMITER`, async () => {
      const name = `znv-cli-binary-${process.pid.toString()}-${fixture.client}`;
      const started = docker([
        'run', '-d', '--rm', '--name', name,
        '-e', fixture.allowEmptyPasswordEnv,
        fixture.image,
        '--skip-log-bin',
      ]);
      expect(started.status, started.stderr).toBe(0);

      try {
        await waitUntilReady(name, fixture.admin);
        const printDefaultsCanary = 'znv_synthetic_print_defaults_canary';
        const canaryCnfPath = '/tmp/znv-print-defaults-canary.cnf';
        const canaryCnf = [
          '[client]',
          'user=root',
          `password=${printDefaultsCanary}`,
          'host=127.0.0.1',
          '',
        ].join('\n');
        const wroteCanary = docker([
          'exec', '-i', name, 'sh', '-c',
          `umask 077\ncat > ${canaryCnfPath}`,
        ], canaryCnf);
        expect(wroteCanary.status, wroteCanary.stderr).toBe(0);

        const rawPrintDefaults = docker([
          'exec', name, fixture.client,
          `--defaults-file=${canaryCnfPath}`, '--print-defaults',
        ]);
        expect(rawPrintDefaults.status, rawPrintDefaults.stderr).toBe(0);
        if (fixture.client === 'mariadb') {
          // MariaDB 11 really emits the option-file password in plaintext.
          expect(rawPrintDefaults.stdout).toContain(printDefaultsCanary);
        } else {
          // Oracle currently masks it, but the dual-client policy still blocks
          // the option and does not rely on that implementation detail.
          expect(rawPrintDefaults.stdout).not.toContain(printDefaultsCanary);
        }
        for (const introspectionArgs of [
          ['--help'],
          ['--verbose', '--help'],
          ['--version'],
        ]) {
          const introspection = docker([
            'exec', name, fixture.client,
            `--defaults-file=${canaryCnfPath}`,
            ...introspectionArgs,
          ]);
          expect(introspection.stdout).not.toContain(printDefaultsCanary);
        }

        // Both clients honour the option terminator before the positional
        // database. A value that looks like --print-defaults is no longer
        // interpreted as an option and therefore cannot expose the canary.
        const terminatedInjection = docker([
          'exec', name, fixture.client,
          `--defaults-file=${canaryCnfPath}`,
          '--', '--print-defaults',
        ]);
        expect(terminatedInjection.stdout).not.toContain(printDefaultsCanary);
        expect(() => assertSafeMysqlDatabase('--print-defaults')).toThrow(
          /Invalid MySQL database\/schema/,
        );

        const safeTerminatedDatabase = docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '-h127.0.0.1', '-uroot', '--batch',
          '--', 'mysql',
        ], 'SELECT 1;\n');
        expect(safeTerminatedDatabase.status, safeTerminatedDatabase.stderr).toBe(0);
        expect(safeTerminatedDatabase.stdout).toMatch(/(?:^|\n)1(?:\n|$)/);

        // Recovery phases must never use --force: the first SQL error must
        // produce a non-zero client exit and prevent subsequent statements
        // from being mistaken for a successful phase.
        const sqlErrorMarker = 'znv_cli_sql_error_marker';
        const sqlWithError = [
          `DROP DATABASE IF EXISTS ${sqlErrorMarker};`,
          'SELECT 1;',
          'THIS IS NOT VALID SQL;',
          `CREATE DATABASE ${sqlErrorMarker};`,
          '',
        ].join('\n');
        const failedSql = docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '--binary-mode', '-h127.0.0.1', '-uroot',
          '--batch', '--skip-column-names',
        ], sqlWithError);
        expect(failedSql.status, failedSql.stderr).not.toBe(0);
        expect(failedSql.stdout).toMatch(/(?:^|\n)1(?:\n|$)/);

        const markerQuery = docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '--binary-mode', '-h127.0.0.1', '-uroot',
          '--batch', '--skip-column-names',
        ], [
          'SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA',
          `WHERE SCHEMA_NAME = '${sqlErrorMarker}';`,
          '',
        ].join('\n'));
        expect(markerQuery.status, markerQuery.stderr).toBe(0);
        expect(markerQuery.stdout.trim()).toBe('0');

        for (const printDefaultsBypass of [
          '--print-defaults',
          '--pri',
          '--loose-print-defaults',
          '--future-wrapper-pri',
        ]) {
          expect(() => assertPassthroughAllowed([printDefaultsBypass])).toThrow(
            /credentials.*never be printed/s,
          );
        }

        const hostile = [
          '\\! touch /tmp/znv-bang',
          'system touch /tmp/znv-system',
          'SELECT 1;',
          '',
        ].join('\n');

        const baseline = docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '-h127.0.0.1', '-uroot', '--force',
        ], hostile);
        expect(baseline.status, baseline.stderr).toBe(0);
        expect(docker([
          'exec', name, 'sh', '-c',
          'test -e /tmp/znv-bang && test -e /tmp/znv-system',
        ]).status).toBe(0);

        expect(docker([
          'exec', name, 'sh', '-c',
          'rm -f /tmp/znv-bang /tmp/znv-system',
        ]).status).toBe(0);
        docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '--binary-mode', '-h127.0.0.1', '-uroot', '--force',
        ], hostile);
        expect(docker([
          'exec', name, 'sh', '-c',
          'test ! -e /tmp/znv-bang && test ! -e /tmp/znv-system',
        ]).status).toBe(0);

        // Both client families compose long-option modifiers. When one of
        // these tokens follows --binary-mode, the raw client re-enables local
        // commands; ZnVault must reject it before spawning the client.
        const modifierBypasses = [
          '--enable-skip-binary-mode',
          '--loose-enable-skip-binary-mode',
          '--maximum-binary-mode=0',
          '--loose-maximum-binary-mode=0',
          '--maximum-skip-binary-mode',
          ...fixture.familySpecificModifierBypasses,
        ];
        for (const bypass of modifierBypasses) {
          await waitUntilReady(name, fixture.admin);
          expect(docker([
            'exec', name, 'sh', '-c',
            'rm -f /tmp/znv-bang /tmp/znv-system',
          ]).status).toBe(0);
          const bypassed = docker([
            'exec', '-i', name, fixture.client,
            '--no-defaults', '--binary-mode', bypass,
            '-h127.0.0.1', '-uroot', '--force',
          ], hostile);
          expect(bypassed.status, bypassed.stderr).toBe(0);
          expect(docker([
            'exec', name, 'sh', '-c',
            'test -e /tmp/znv-bang && test -e /tmp/znv-system',
          ]).status).toBe(0);
          expect(() => assertPassthroughAllowed([bypass])).toThrow(
            /is not allowed.*binary-mode/s,
          );
        }

        const delimiterSql = [
          'CREATE DATABASE IF NOT EXISTS znv_cli_test;',
          'USE znv_cli_test;',
          'DROP PROCEDURE IF EXISTS p;',
          'DELIMITER //',
          'CREATE PROCEDURE p() BEGIN SELECT 42 AS answer; END//',
          'DELIMITER ;',
          'CALL p();',
          'DROP PROCEDURE p;',
          'DROP DATABASE znv_cli_test;',
          '',
        ].join('\n');
        const delimiter = docker([
          'exec', '-i', name, fixture.client,
          '--no-defaults', '--binary-mode', '-h127.0.0.1', '-uroot', '--batch',
        ], delimiterSql);
        expect(delimiter.status, delimiter.stderr).toBe(0);
        expect(delimiter.stdout).toMatch(/(?:^|\n)42(?:\n|$)/);
      } finally {
        docker(['rm', '-f', name]);
      }
    }, 60_000);
  }
});
