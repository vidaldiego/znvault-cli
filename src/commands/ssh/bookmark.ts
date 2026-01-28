// Path: src/commands/ssh/bookmark.ts

/**
 * SSH host bookmark commands
 */

import type { Command } from 'commander';
import * as output from '../../lib/output.js';
import { getCurrentProfile, saveProfile, getActiveProfileName } from '../../lib/config.js';
import type { SSHBookmark } from '../../lib/config/types.js';
import { promptConfirm } from '../../lib/prompts.js';

export function registerBookmarkCommands(parent: Command): void {
  const bookmark = parent
    .command('bookmark')
    .alias('bm')
    .description('Manage SSH host bookmarks');

  // List bookmarks
  bookmark
    .command('list')
    .alias('ls')
    .description('List all bookmarks')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const profile = getCurrentProfile();
      const bookmarks = profile.sshBookmarks ?? {};

      if (options.json) {
        output.json(bookmarks);
        return;
      }

      const entries = Object.entries(bookmarks);
      if (entries.length === 0) {
        output.info('No bookmarks configured');
        output.info('Add one with: znvault ssh bookmark add <name> <host>');
        return;
      }

      output.section('SSH Bookmarks');
      output.table(
        ['Name', 'Host', 'Port', 'User', 'Description'],
        entries.map(([name, bm]) => [
          name,
          bm.host,
          bm.port?.toString() ?? '22',
          bm.user ?? '(default)',
          bm.description ?? '-',
        ])
      );
      output.info(`Total: ${entries.length} bookmark(s)`);
    });

  // Add bookmark
  bookmark
    .command('add <name> <host>')
    .description('Add a new bookmark')
    .option('-p, --port <port>', 'SSH port')
    .option('-u, --user <user>', 'SSH username')
    .option('-i, --identity <file>', 'SSH identity file')
    .option('--principals <list>', 'Default principals (comma-separated)')
    .option('-d, --description <text>', 'Bookmark description')
    .action(async (name: string, host: string, options: {
      port?: string;
      user?: string;
      identity?: string;
      principals?: string;
      description?: string;
    }) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      if (!profile.sshBookmarks) {
        profile.sshBookmarks = {};
      }

      if (profile.sshBookmarks[name]) {
        output.error(`Bookmark '${name}' already exists`);
        output.info('Use "znvault ssh bookmark update" to modify it');
        process.exit(1);
      }

      const bookmark: SSHBookmark = {
        host,
        createdAt: new Date().toISOString(),
      };

      if (options.port) {
        bookmark.port = parseInt(options.port, 10);
      }
      if (options.user) {
        bookmark.user = options.user;
      }
      if (options.identity) {
        const path = await import('path');
        bookmark.identity = path.resolve(options.identity.replace(/^~/, process.env.HOME ?? ''));
      }
      if (options.principals) {
        bookmark.principals = options.principals.split(',').map(p => p.trim());
      }
      if (options.description) {
        bookmark.description = options.description;
      }

      profile.sshBookmarks[name] = bookmark;
      saveProfile(profileName, profile);

      output.success(`Bookmark '${name}' added`);
      output.keyValue({
        'Name': name,
        'Host': bookmark.host,
        'Port': bookmark.port?.toString() ?? '22',
        'User': bookmark.user ?? '(default)',
      });
    });

  // Update bookmark
  bookmark
    .command('update <name>')
    .description('Update an existing bookmark')
    .option('-H, --host <host>', 'New host')
    .option('-p, --port <port>', 'SSH port')
    .option('-u, --user <user>', 'SSH username')
    .option('-i, --identity <file>', 'SSH identity file')
    .option('--principals <list>', 'Default principals (comma-separated)')
    .option('-d, --description <text>', 'Bookmark description')
    .action(async (name: string, options: {
      host?: string;
      port?: string;
      user?: string;
      identity?: string;
      principals?: string;
      description?: string;
    }) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      if (!profile.sshBookmarks?.[name]) {
        output.error(`Bookmark '${name}' not found`);
        process.exit(1);
      }

      const bookmark = profile.sshBookmarks[name];

      if (options.host) {
        bookmark.host = options.host;
      }
      if (options.port) {
        bookmark.port = parseInt(options.port, 10);
      }
      if (options.user) {
        bookmark.user = options.user;
      }
      if (options.identity) {
        const path = await import('path');
        bookmark.identity = path.resolve(options.identity.replace(/^~/, process.env.HOME ?? ''));
      }
      if (options.principals) {
        bookmark.principals = options.principals.split(',').map(p => p.trim());
      }
      if (options.description) {
        bookmark.description = options.description;
      }

      saveProfile(profileName, profile);
      output.success(`Bookmark '${name}' updated`);
    });

  // Remove bookmark
  bookmark
    .command('remove <name>')
    .alias('rm')
    .description('Remove a bookmark')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (name: string, options: { yes?: boolean }) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      if (!profile.sshBookmarks?.[name]) {
        output.error(`Bookmark '${name}' not found`);
        process.exit(1);
      }

      if (!options.yes) {
        const confirmed = await promptConfirm(`Remove bookmark '${name}'?`);
        if (!confirmed) {
          output.info('Cancelled');
          return;
        }
      }

      delete profile.sshBookmarks[name];
      saveProfile(profileName, profile);
      output.success(`Bookmark '${name}' removed`);
    });

  // Show bookmark details
  bookmark
    .command('show <name>')
    .description('Show bookmark details')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const profile = getCurrentProfile();

      if (!profile.sshBookmarks?.[name]) {
        output.error(`Bookmark '${name}' not found`);
        process.exit(1);
      }

      const bookmark = profile.sshBookmarks[name];

      if (options.json) {
        output.json({ name, ...bookmark });
        return;
      }

      output.section(`Bookmark: ${name}`);
      output.keyValue({
        'Host': bookmark.host,
        'Port': bookmark.port?.toString() ?? '22',
        'User': bookmark.user ?? '(default)',
        'Identity': bookmark.identity ?? '(default)',
        'Principals': bookmark.principals?.join(', ') ?? '(from mapping)',
        'Description': bookmark.description ?? '-',
        'Created': output.formatDate(bookmark.createdAt),
      });

      console.log();
      output.info(`Connect: znvault ssh ${name}`);
    });

  // Rename bookmark
  bookmark
    .command('rename <oldName> <newName>')
    .description('Rename a bookmark')
    .action(async (oldName: string, newName: string) => {
      const profile = getCurrentProfile();
      const profileName = getActiveProfileName();

      if (!profile.sshBookmarks?.[oldName]) {
        output.error(`Bookmark '${oldName}' not found`);
        process.exit(1);
      }

      if (profile.sshBookmarks[newName]) {
        output.error(`Bookmark '${newName}' already exists`);
        process.exit(1);
      }

      profile.sshBookmarks[newName] = profile.sshBookmarks[oldName];
      delete profile.sshBookmarks[oldName];
      saveProfile(profileName, profile);

      output.success(`Bookmark renamed: ${oldName} → ${newName}`);
    });
}

/**
 * Resolve a bookmark by name, returning the bookmark or null if not found
 */
export function resolveBookmark(name: string): SSHBookmark | null {
  const profile = getCurrentProfile();
  return profile.sshBookmarks?.[name] ?? null;
}
