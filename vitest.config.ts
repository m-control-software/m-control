import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against sources: no build needed first, and a test never sees
    // a stale dist/. Keep in sync with `paths` in tsconfig.json.
    alias: {
      '@m-control/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@m-control/test-support': path.resolve(
        __dirname,
        'test-support/index.ts'
      ),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      // Standalone tools are not npm packages, but their protocol behaviour
      // still needs guarding — they are spawned as processes from these tests.
      'tools/**/test/**/*.test.ts',
      // Repo-wide checks: conformance of every tool, docs, scaffolding.
      'test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
