import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@sovra/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@sovra/crypto': path.resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@sovra/identity': path.resolve(__dirname, 'packages/identity/src/index.ts'),
      '@sovra/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@sovra/p2p': path.resolve(__dirname, 'packages/p2p/src/index.ts'),
      '@sovra/storage': path.resolve(__dirname, 'packages/storage/src/index.ts'),
      '@sovra/messaging': path.resolve(__dirname, 'packages/messaging/src/index.ts'),
      '@sovra/social': path.resolve(__dirname, 'packages/social/src/index.ts'),
      '@sovra/moderation': path.resolve(__dirname, 'packages/moderation/src/index.ts'),
      '@sovra/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@sovra/app': path.resolve(__dirname, 'apps/sovra-app/src/index.ts'),
      '@sovra/admin': path.resolve(__dirname, 'apps/sovra-admin/src/index.ts'),
      '@sovra/storage-node': path.resolve(__dirname, 'nodes/storage-node/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'nodes/**/*.test.ts',
      'services/**/*.test.ts',
      'tests/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/dist/**', '**/node_modules/**', '**/tests/**'],
    },
  },
});
