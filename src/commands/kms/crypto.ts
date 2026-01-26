// Path: src/commands/kms/crypto.ts

/**
 * KMS cryptographic operations (encrypt, decrypt, generate-data-key)
 */

import type { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  EncryptResponse,
  DecryptResponse,
  GenerateDataKeyResponse,
  EncryptOptions,
  DecryptOptions,
  GenerateDataKeyOptions,
} from './types.js';
import { parseContext } from './helpers.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function encryptData(keyId: string, data: string | undefined, options: EncryptOptions): Promise<void> {
  let plaintext: string;

  if (options.file) {
    const fs = await import('fs');
    if (!fs.existsSync(options.file)) {
      output.error(`File not found: ${options.file}`);
      process.exit(1);
    }
    const content = fs.readFileSync(options.file);
    plaintext = content.toString('base64');
  } else if (data) {
    plaintext = Buffer.from(data).toString('base64');
  } else {
    // Interactive prompt
    const { inputData } = await inquirer.prompt<{ inputData: string }>([
      { type: 'input', name: 'inputData', message: 'Data to encrypt:' },
    ]);
    plaintext = Buffer.from(inputData).toString('base64');
  }

  const spinner = ora('Encrypting data...').start();

  try {
    const body = {
      keyId,
      plaintext,
      context: parseContext(options.context),
    };

    const result = await client.post<EncryptResponse>('/v1/kms/encrypt', body);
    spinner.stop();

    if (options.output) {
      const fs = await import('fs');
      fs.writeFileSync(options.output, result.ciphertext);
      output.success(`Encrypted data written to: ${options.output}`);
      return;
    }

    if (options.json) {
      output.json(result);
      return;
    }

    console.log('\n--- Encrypted Data ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`\nCiphertext (base64):`);
    console.log(result.ciphertext);

    if (Object.keys(result.encryptionContext).length > 0) {
      console.log(`\nEncryption Context:`);
      console.log(JSON.stringify(result.encryptionContext, null, 2));
    }
  } catch (error) {
    spinner.fail('Failed to encrypt data');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function decryptData(keyId: string, ciphertext: string | undefined, options: DecryptOptions): Promise<void> {
  let ciphertextData: string;

  if (!ciphertext) {
    // Interactive prompt
    const { inputCiphertext } = await inquirer.prompt<{ inputCiphertext: string }>([
      { type: 'input', name: 'inputCiphertext', message: 'Ciphertext (base64):' },
    ]);
    ciphertextData = inputCiphertext;
  } else {
    // Check if it's a file path
    const fs = await import('fs');
    if (fs.existsSync(ciphertext)) {
      ciphertextData = fs.readFileSync(ciphertext, 'utf-8').trim();
    } else {
      ciphertextData = ciphertext;
    }
  }

  const spinner = ora('Decrypting data...').start();

  try {
    const body = {
      keyId,
      ciphertext: ciphertextData,
      context: parseContext(options.context),
    };

    const result = await client.post<DecryptResponse>('/v1/kms/decrypt', body);
    spinner.stop();

    const decrypted = Buffer.from(result.plaintext, 'base64');

    if (options.output) {
      const fs = await import('fs');
      fs.writeFileSync(options.output, decrypted);
      output.success(`Decrypted data written to: ${options.output}`);
      return;
    }

    if (options.json) {
      output.json({
        keyId: result.keyId,
        plaintext: decrypted.toString('utf-8'),
        encryptionContext: result.encryptionContext,
      });
      return;
    }

    console.log('\n--- Decrypted Data ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`\nPlaintext:`);
    console.log(decrypted.toString('utf-8'));
  } catch (error) {
    spinner.fail('Failed to decrypt data');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function generateDataKey(keyId: string, options: GenerateDataKeyOptions): Promise<void> {
  const spinner = ora('Generating data key...').start();

  try {
    const body = {
      keyId,
      keySpec: options.spec || 'AES_256',
      context: parseContext(options.context),
    };

    const result = await client.post<GenerateDataKeyResponse>('/v1/kms/generate-data-key', body);
    spinner.stop();

    if (options.output && result.plaintext) {
      const fs = await import('fs');
      const keyData = Buffer.from(result.plaintext, 'base64');
      fs.writeFileSync(options.output, keyData);
      output.success(`Data key written to: ${options.output}`);
      console.log(`\nEncrypted key (store this to decrypt the data key later):`);
      console.log(result.ciphertext);
      return;
    }

    if (options.json) {
      output.json(result);
      return;
    }

    console.log('\n--- Generated Data Key ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`Key Spec: ${options.spec || 'AES_256'}`);
    if (result.plaintext) {
      console.log(`\nPlaintext Data Key (base64):`);
      console.log(result.plaintext);
    }
    console.log(`\nEncrypted Data Key (base64):`);
    console.log(result.ciphertext);
    output.info('\nStore the encrypted key to unwrap the data key later using KMS decrypt.');
  } catch (error) {
    spinner.fail('Failed to generate data key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerCryptoCommands(parent: Command): void {
  // Encrypt data
  parent
    .command('encrypt <keyId> [data]')
    .description('Encrypt data using a KMS key')
    .option('-c, --context <context>', 'Encryption context (JSON or key=value,...)')
    .option('-f, --file <file>', 'Read data from file')
    .option('-o, --output <file>', 'Write ciphertext to file')
    .option('--json', 'Output as JSON')
    .action(encryptData);

  // Decrypt data
  parent
    .command('decrypt <keyId> [ciphertext]')
    .description('Decrypt data using a KMS key')
    .option('-c, --context <context>', 'Encryption context (JSON or key=value,...)')
    .option('-o, --output <file>', 'Write plaintext to file')
    .option('--json', 'Output as JSON')
    .action(decryptData);

  // Generate data key
  parent
    .command('generate-data-key <keyId>')
    .description('Generate a data encryption key (DEK)')
    .option('--spec <spec>', 'Key spec (AES_256, AES_128)', 'AES_256')
    .option('-c, --context <context>', 'Encryption context')
    .option('-o, --output <file>', 'Write plaintext key to file')
    .option('--json', 'Output as JSON')
    .action(generateDataKey);
}
