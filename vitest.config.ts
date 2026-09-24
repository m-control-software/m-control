import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      // Standalone tools are not npm packages, but their protocol behaviour
      // still needs guarding — they are spawned as processes from these tests.
      'tools/**/test/**/*.test.ts',
    ],
    // Core is tested from TypeScript sources directly — no build needed first
    environment: 'node',
  },
});
