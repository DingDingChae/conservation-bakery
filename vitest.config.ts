import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
    // The conservation suite is the gate for the whole project. It must never be
    // silently skipped by a timeout on a slow machine.
    testTimeout: 120_000,
  },
});
