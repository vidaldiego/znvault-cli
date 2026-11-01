#!/usr/bin/env node
import { selectRecoveryBootstrap } from './commands/recovery/bootstrap.js';

// Choose the offline graph before importing anything with connected CLI effects.
if (selectRecoveryBootstrap(process.argv.slice(2)) === 'offline-recovery') {
  const { runLocalRecovery } = await import('./commands/recovery/index.js');
  await runLocalRecovery();
} else {
  await import('./main.js');
}
