import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Setup file runs before all tests to ensure config isolation
    setupFiles: ['./test/setup.ts'],
    // Exclude integration tests from regular runs
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**']
    }
  }
});
