import { input, password, confirm, select } from '@inquirer/prompts';

/**
 * Prompt for username
 */
export async function promptUsername(message = 'Username'): Promise<string> {
  return input({
    message,
    validate: (value) => {
      if (!value.trim()) return 'Username is required';
      return true;
    },
  });
}

/**
 * Prompt for password
 */
export async function promptPassword(message = 'Password'): Promise<string> {
  return password({
    message,
    mask: '*',
    validate: (value) => {
      if (!value) return 'Password is required';
      return true;
    },
  });
}

/**
 * Prompt for TOTP code
 */
export async function promptTotp(message = 'TOTP Code (if enabled)'): Promise<string | undefined> {
  const code = await input({
    message,
    validate: (value) => {
      if (value && !/^\d{6}$/.test(value)) return 'TOTP code must be 6 digits';
      return true;
    },
  });
  return code || undefined;
}

/**
 * Prompt for confirmation
 */
export async function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  return confirm({
    message,
    default: defaultValue,
  });
}

/**
 * Prompt for text input
 */
export async function promptInput(message: string, defaultValue?: string): Promise<string> {
  return input({
    message,
    default: defaultValue,
  });
}

/**
 * Prompt for selection
 */
export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  return select({
    message,
    choices,
  });
}

/**
 * Prompt for new password with confirmation
 */
export async function promptNewPassword(message = 'New Password'): Promise<string> {
  const newPass = await password({
    message,
    mask: '*',
    validate: (value) => {
      if (!value) return 'Password is required';
      if (value.length < 8) return 'Password must be at least 8 characters';
      return true;
    },
  });

  const confirmPass = await password({
    message: 'Confirm Password',
    mask: '*',
    validate: (value) => {
      if (value !== newPass) return 'Passwords do not match';
      return true;
    },
  });

  return confirmPass;
}
