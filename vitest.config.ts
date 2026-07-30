import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Core is tested from TypeScript sources directly — no build needed first
    environment: 'node',
  },
});
