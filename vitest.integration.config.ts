// Path: znvault-cli/vitest.integration.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run all tests including integration tests
    include: ['test/**/*.test.ts'],
    // Longer timeout for integration tests
    testTimeout: 60000,
    hookTimeout: 30000,
    // Run tests sequentially (not in parallel) to avoid login conflicts
    // Vitest 4 uses fileParallelism instead of poolOptions
    fileParallelism: false,
  },
});
