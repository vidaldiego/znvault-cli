// Path: znvault-cli/src/commands/notification.ts
// CLI commands for notification (email) configuration

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface NotificationStatus {
  configured: boolean;
  message: string;
}

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  fromName?: string;
}

interface ConfigResponse {
  config: SMTPConfig;
}

interface RecipientsResponse {
  recipients: string;
}

interface StatusOptions {
  json?: boolean;
}

interface ConfigOptions {
  json?: boolean;
}

interface SetupOptions {
  host: string;
  port: string;
  secure?: boolean;
  user: string;
  password?: string;
  from: string;
  fromName?: string;
  json?: boolean;
}

interface TestOptions {
  email?: string;
}

interface RecipientsOptions {
  json?: boolean;
}

// ============================================================================
// Command Implementations
// ============================================================================

async function showStatus(options: StatusOptions): Promise<void> {
  const spinner = ora('Checking notification status...').start();

  try {
    const status = await client.get<NotificationStatus>('/v1/admin/notifications/status');
    spinner.stop();

    if (options.json) {
      output.json(status);
      return;
    }

    if (status.configured) {
      output.success('Email notifications are configured');
    } else {
      output.warn('Email notifications are NOT configured');
    }
    console.log(`  ${status.message}`);
  } catch (error) {
    spinner.fail('Failed to get status');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function showConfig(options: ConfigOptions): Promise<void> {
  const spinner = ora('Fetching SMTP configuration...').start();

  try {
    const response = await client.get<ConfigResponse>('/v1/admin/notifications/config');
    spinner.stop();

    if (options.json) {
      output.json(response.config);
      return;
    }

    const config = response.config;
    const table = new Table({
      colWidths: [20, 50],
    });

    table.push(
      ['Host', config.host],
      ['Port', String(config.port)],
      ['Secure (TLS)', config.secure ? 'Yes' : 'No'],
      ['Username', config.auth.user],
      ['Password', config.auth.pass], // Already redacted by server
      ['From Address', config.from],
      ['From Name', config.fromName || '-'],
    );

    console.log('\nSMTP Configuration:');
    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to get configuration');
    if ((error as Error).message.includes('404')) {
      output.info('No SMTP configuration found. Use "znvault notification setup" to configure.');
    } else {
      output.error((error as Error).message);
    }
    process.exit(1);
  }
}

async function setupConfig(options: SetupOptions): Promise<void> {
  let host = options.host;
  let port = parseInt(options.port, 10);
  let secure = options.secure ?? true;
  let user = options.user;
  let password = options.password;
  let from = options.from;
  let fromName = options.fromName;

  // Interactive mode if not all required options provided
  if (!host || !port || !user || !from) {
    output.info('Interactive SMTP configuration setup\n');

    const answers = await inquirer.prompt<{
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      from: string;
      fromName: string;
    }>([
      {
        type: 'input',
        name: 'host',
        message: 'SMTP Host:',
        default: host || 'smtp.gmail.com',
        validate: (input: string) => input.length > 0 || 'Host is required',
      },
      {
        type: 'number',
        name: 'port',
        message: 'SMTP Port:',
        default: port || 587,
        validate: (input: number) => (input > 0 && input < 65536) || 'Port must be between 1 and 65535',
      },
      {
        type: 'confirm',
        name: 'secure',
        message: 'Use TLS/SSL?',
        default: secure,
      },
      {
        type: 'input',
        name: 'user',
        message: 'SMTP Username:',
        default: user,
        validate: (input: string) => input.length > 0 || 'Username is required',
      },
      {
        type: 'password',
        name: 'password',
        message: 'SMTP Password:',
        mask: '*',
        validate: (input: string) => input.length > 0 || 'Password is required',
      },
      {
        type: 'input',
        name: 'from',
        message: 'From Address (e.g., noreply@example.com):',
        default: from,
        validate: (input: string) => input.includes('@') || 'Must be a valid email address',
      },
      {
        type: 'input',
        name: 'fromName',
        message: 'From Name (optional):',
        default: fromName || 'ZN-Vault',
      },
    ]);

    host = answers.host;
    port = answers.port;
    secure = answers.secure;
    user = answers.user;
    password = answers.password;
    from = answers.from;
    fromName = answers.fromName;
  }

  if (!password) {
    const { pwd } = await inquirer.prompt<{ pwd: string }>([
      {
        type: 'password',
        name: 'pwd',
        message: 'SMTP Password:',
        mask: '*',
        validate: (input: string) => input.length > 0 || 'Password is required',
      },
    ]);
    password = pwd;
  }

  const spinner = ora('Saving SMTP configuration...').start();

  try {
    const body = {
      host,
      port,
      secure,
      auth: {
        user,
        pass: password,
      },
      from,
      fromName: fromName || undefined,
    };

    const result = await client.patch<{ message: string; configured: boolean }>('/v1/admin/notifications/config', body);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('SMTP configuration saved successfully!');

    // Offer to test
    const { testNow } = await inquirer.prompt<{ testNow: boolean }>([
      {
        type: 'confirm',
        name: 'testNow',
        message: 'Send a test email now?',
        default: true,
      },
    ]);

    if (testNow) {
      await testEmail({});
    }
  } catch (error) {
    spinner.fail('Failed to save configuration');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function testEmail(options: TestOptions): Promise<void> {
  const spinner = ora('Sending test email...').start();

  try {
    const body: Record<string, string | undefined> = {};
    if (options.email) body.to = options.email;

    const result = await client.post<{ message: string }>('/v1/admin/notifications/test', body);
    spinner.stop();

    output.success(result.message);
  } catch (error) {
    spinner.fail('Failed to send test email');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function removeConfig(): Promise<void> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Remove SMTP configuration and disable email notifications?',
      default: false,
    },
  ]);

  if (!confirm) {
    output.info('Cancelled');
    return;
  }

  const spinner = ora('Removing SMTP configuration...').start();

  try {
    const result = await client.delete<{ message: string; configured: boolean }>('/v1/admin/notifications/config');
    spinner.stop();

    output.success(result.message);
  } catch (error) {
    spinner.fail('Failed to remove configuration');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function showRecipients(options: RecipientsOptions): Promise<void> {
  const spinner = ora('Fetching recipients...').start();

  try {
    const response = await client.get<RecipientsResponse>('/v1/admin/notifications/recipients');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (!response.recipients || response.recipients.length === 0) {
      output.info('No notification recipients configured');
      return;
    }

    const emails = response.recipients.split(',').map(e => e.trim()).filter(e => e);
    console.log('\nNotification Recipients:');
    for (const email of emails) {
      console.log(`  - ${email}`);
    }
    console.log(`\nTotal: ${emails.length} recipient(s)`);
  } catch (error) {
    spinner.fail('Failed to get recipients');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function setRecipients(emails: string): Promise<void> {
  // Validate emails
  const emailList = emails.split(',').map(e => e.trim()).filter(e => e);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const email of emailList) {
    if (!emailRegex.test(email)) {
      output.error(`Invalid email format: ${email}`);
      process.exit(1);
    }
  }

  const spinner = ora('Updating recipients...').start();

  try {
    const result = await client.patch<{ message: string }>('/v1/admin/notifications/recipients', {
      recipients: emails,
    });
    spinner.stop();

    output.success(result.message);
    console.log(`  Recipients: ${emailList.join(', ')}`);
  } catch (error) {
    spinner.fail('Failed to update recipients');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function addRecipient(email: string): Promise<void> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    output.error(`Invalid email format: ${email}`);
    process.exit(1);
  }

  const spinner = ora('Adding recipient...').start();

  try {
    // Get current recipients
    const response = await client.get<RecipientsResponse>('/v1/admin/notifications/recipients');
    const currentEmails = response.recipients ? response.recipients.split(',').map(e => e.trim()).filter(e => e) : [];

    if (currentEmails.includes(email)) {
      spinner.stop();
      output.info(`${email} is already a recipient`);
      return;
    }

    currentEmails.push(email);

    await client.patch<{ message: string }>('/v1/admin/notifications/recipients', {
      recipients: currentEmails.join(','),
    });
    spinner.stop();

    output.success(`Added ${email} to notification recipients`);
  } catch (error) {
    spinner.fail('Failed to add recipient');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function removeRecipient(email: string): Promise<void> {
  const spinner = ora('Removing recipient...').start();

  try {
    // Get current recipients
    const response = await client.get<RecipientsResponse>('/v1/admin/notifications/recipients');
    const currentEmails = response.recipients ? response.recipients.split(',').map(e => e.trim()).filter(e => e) : [];

    const index = currentEmails.indexOf(email);
    if (index === -1) {
      spinner.stop();
      output.info(`${email} is not in the recipients list`);
      return;
    }

    currentEmails.splice(index, 1);

    await client.patch<{ message: string }>('/v1/admin/notifications/recipients', {
      recipients: currentEmails.join(','),
    });
    spinner.stop();

    output.success(`Removed ${email} from notification recipients`);
  } catch (error) {
    spinner.fail('Failed to remove recipient');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerNotificationCommands(program: Command): void {
  const notification = program
    .command('notification')
    .description('Email notification configuration');

  // Show status
  notification
    .command('status')
    .description('Check if email notifications are configured')
    .option('--json', 'Output as JSON')
    .action(showStatus);

  // Show config
  notification
    .command('config')
    .description('Show current SMTP configuration')
    .option('--json', 'Output as JSON')
    .action(showConfig);

  // Setup/update config
  notification
    .command('setup')
    .description('Configure SMTP settings (interactive)')
    .option('--host <host>', 'SMTP host')
    .option('--port <port>', 'SMTP port')
    .option('--secure', 'Use TLS/SSL')
    .option('--no-secure', 'Do not use TLS/SSL')
    .option('--user <user>', 'SMTP username')
    .option('--password <pass>', 'SMTP password')
    .option('--from <email>', 'From email address')
    .option('--from-name <name>', 'From display name')
    .option('--json', 'Output as JSON')
    .action(setupConfig);

  // Test email
  notification
    .command('test')
    .description('Send a test email')
    .option('--email <address>', 'Send test to specific address')
    .action(testEmail);

  // Remove config
  notification
    .command('remove')
    .description('Remove SMTP configuration (disable notifications)')
    .action(removeConfig);

  // Show recipients
  notification
    .command('recipients')
    .description('Show notification recipients')
    .option('--json', 'Output as JSON')
    .action(showRecipients);

  // Set recipients
  notification
    .command('set-recipients <emails>')
    .description('Set notification recipients (comma-separated)')
    .action(setRecipients);

  // Add recipient
  notification
    .command('add-recipient <email>')
    .description('Add a notification recipient')
    .action(addRecipient);

  // Remove recipient
  notification
    .command('remove-recipient <email>')
    .description('Remove a notification recipient')
    .action(removeRecipient);
}
