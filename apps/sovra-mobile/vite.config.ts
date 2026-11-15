import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: ['es2022', 'chrome100', 'safari15'],
  },
  resolve: {
    alias: {
      '@sovra/crypto': path.resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@sovra/identity': path.resolve(__dirname, '../../packages/identity/src/index.ts'),
      '@sovra/p2p': path.resolve(__dirname, '../../packages/p2p/src/index.ts'),
      '@sovra/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@sovra/messaging': path.resolve(__dirname, '../../packages/messaging/src/index.ts'),
      '@sovra/social': path.resolve(__dirname, '../../packages/social/src/index.ts'),
      '@sovra/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
    },
  },
  server: {
    port: 3002,
    host: true,
  },
});
