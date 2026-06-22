// Path: src/commands/host/config.ts
// View and edit host configuration

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';

import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import type { ConfigOptions, HostConfig } from './types.js';
import { formatConfigYaml, hostPermissionHint } from './helpers.js';

/**
 * Open editor and return the edited content
 */
async function editInEditor(content: string): Promise<string> {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
  const tmpFile = path.join(os.tmpdir(), `znvault-host-config-${Date.now()}.json`);

  // Write content to temp file
  fs.writeFileSync(tmpFile, content, 'utf-8');

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [tmpFile], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('error', (err) => {
      fs.unlinkSync(tmpFile);
      reject(new Error(`Failed to open editor: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        fs.unlinkSync(tmpFile);
        reject(new Error(`Editor exited with code ${code}`));
        return;
      }

      try {
        const edited = fs.readFileSync(tmpFile, 'utf-8');
        fs.unlinkSync(tmpFile);
        resolve(edited);
      } catch (err) {
        reject(new Error(`Failed to read edited file: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

/**
 * Register the config command
 */
export function registerConfigCommand(parentCmd: Command): void {
  parentCmd
    .command('config <hostname>')
    .description('View or edit host configuration')
    .option('-e, --edit', 'Open config in editor')
    .option('-i, --import <file>', 'Import config from JSON file')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: ConfigOptions) => {
      const spinner = output.spinner('Fetching host configuration...').start();

      try {
        // Get current config
        const host = await mode.apiGet<HostConfig>(
          `/v1/hosts/${encodeURIComponent(hostname)}`
        );

        spinner.stop();

        // Import from file
        if (options.import) {
          spinner.text = 'Importing configuration...';
          spinner.start();

          let newConfig: HostConfig['config'];
          try {
            const content = fs.readFileSync(options.import, 'utf-8');
            newConfig = JSON.parse(content) as HostConfig['config'];
          } catch (err) {
            spinner.fail('Failed to read import file');
            output.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }

          const updated = await mode.apiPut<HostConfig>(
            `/v1/hosts/${encodeURIComponent(hostname)}`,
            { config: newConfig }
          );

          spinner.succeed(`Configuration imported (version ${updated.version})`);

          if (options.json) {
            output.json(updated);
          }
          return;
        }

        // Edit in editor
        if (options.edit) {
          const configJson = JSON.stringify(host.config, null, 2);

          console.log('Opening config in editor...');
          console.log('(Save and close the editor to apply changes, or exit without saving to cancel)');
          console.log();

          let editedContent: string;
          try {
            editedContent = await editInEditor(configJson);
          } catch (err) {
            output.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }

          // Parse and validate
          let newConfig: HostConfig['config'];
          try {
            newConfig = JSON.parse(editedContent) as HostConfig['config'];
          } catch (err) {
            output.error('Invalid JSON in edited config');
            output.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }

          // Check if changed
          if (JSON.stringify(newConfig) === JSON.stringify(host.config)) {
            console.log('No changes made.');
            return;
          }

          spinner.text = 'Updating configuration...';
          spinner.start();

          const updated = await mode.apiPut<HostConfig>(
            `/v1/hosts/${encodeURIComponent(hostname)}`,
            { config: newConfig }
          );

          spinner.succeed(`Configuration updated (version ${updated.version})`);

          console.log();
          console.log('To push to agents: znvault host sync ' + hostname);
          return;
        }

        // Just display the config
        if (options.json) {
          output.json(host.config);
          return;
        }

        console.log(`Host: ${hostname} (version ${host.version})`);
        console.log();
        console.log(formatConfigYaml(host.config));
        console.log();
        console.log('To edit: znvault host config ' + hostname + ' --edit');
      } catch (err) {
        spinner.fail('Failed to get host configuration');
        output.error(err instanceof Error ? err.message : String(err));
        const hint = hostPermissionHint(err);
        if (hint) output.info(hint);
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
