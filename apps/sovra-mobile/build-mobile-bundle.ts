/**
 * @file apps/sovra-mobile/build-mobile-bundle.ts
 * Standalone Mobile Hybrid App Production Bundler for Capacitor / Android APK.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

export async function buildMobileBundle(): Promise<string> {
  const esbuildPath = path.resolve(rootDir, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js');
  const esbuild = await import('file:///' + esbuildPath.replace(/\\/g, '/'));

  const entryPath = path.resolve(__dirname, 'src/main.tsx');
  const outDir = path.resolve(__dirname, 'dist');
  const outFile = path.join(outDir, 'bundle.js');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('[Mobile Build] Compiling and bundling mobile client assets...');
  await esbuild.build({
    entryPoints: [entryPath],
    outfile: outFile,
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'iife',
    globalName: 'SovraMobileApp',
    platform: 'browser',
    target: ['es2022', 'chrome100', 'firefox100', 'safari15'],
    jsx: 'automatic',
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.jsx': 'jsx',
      '.js': 'js',
    },
    plugins: [
      {
        name: 'node-builtins-shim',
        setup(build: any) {
          build.onResolve({ filter: /^node:(fs|path|crypto|fs\/promises|os|buffer|util|events|http|net)|^(fs|path|http|net|crypto|events|os|buffer)$/ }, (args: any) => {
            return { path: args.path, namespace: 'node-shim' };
          });
          build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args: any) => {
            if (args.path.includes('crypto')) {
              return {
                contents: `
                  const browserCrypto = typeof crypto !== 'undefined' ? crypto : {};
                  export default browserCrypto;
                  export const webcrypto = browserCrypto;
                  export const subtle = browserCrypto.subtle;
                  export function getRandomValues(arr) { return browserCrypto.getRandomValues(arr); }
                  export function randomUUID() { return browserCrypto.randomUUID ? browserCrypto.randomUUID() : 'uuid-' + Math.random(); }
                `,
                loader: 'js',
              };
            }
            if (args.path.includes('path')) {
              return {
                contents: `
                  export default {
                    join: (...args) => args.filter(Boolean).join('/'),
                    resolve: (...args) => args.filter(Boolean).join('/'),
                    basename: (p) => p.split(/[\\/]/).pop(),
                    dirname: (p) => p.split(/[\\/]/).slice(0, -1).join('/') || '.',
                  };
                  export const join = (...args) => args.filter(Boolean).join('/');
                  export const resolve = (...args) => args.filter(Boolean).join('/');
                  export const basename = (p) => p.split(/[\\/]/).pop();
                  export const dirname = (p) => p.split(/[\\/]/).slice(0, -1).join('/') || '.';
                `,
                loader: 'js',
              };
            }
            return {
              contents: `
                export default {};
                export const createServer = () => ({ listen: () => {}, close: () => {} });
                export const existsSync = () => false;
                export const readFileSync = () => '';
                export const writeFileSync = () => {};
                export const mkdirSync = () => {};
              `,
              loader: 'js',
            };
          });
        },
      },
    ],
    alias: {
      '@sovra/shared': path.resolve(rootDir, 'packages/shared/dist/index.js'),
      '@sovra/crypto': path.resolve(rootDir, 'packages/crypto/dist/index.js'),
      '@sovra/identity': path.resolve(rootDir, 'packages/identity/dist/index.js'),
      '@sovra/protocol': path.resolve(rootDir, 'packages/protocol/dist/index.js'),
      '@sovra/p2p': path.resolve(rootDir, 'packages/p2p/dist/index.js'),
      '@sovra/storage': path.resolve(rootDir, 'packages/storage/dist/index.js'),
      '@sovra/messaging': path.resolve(rootDir, 'packages/messaging/dist/index.js'),
      '@sovra/social': path.resolve(rootDir, 'packages/social/dist/index.js'),
      '@sovra/moderation': path.resolve(rootDir, 'packages/moderation/dist/index.js'),
      '@sovra/ui': path.resolve(rootDir, 'packages/ui/dist/index.js'),
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env': '{}',
    },
  });

  // Copy mobile index.html into dist/index.html with bundled script reference
  const htmlSrc = path.join(__dirname, 'index.html');
  const htmlDest = path.join(outDir, 'index.html');
  if (fs.existsSync(htmlSrc)) {
    let htmlContent = fs.readFileSync(htmlSrc, 'utf8');
    htmlContent = htmlContent.replace('/src/main.tsx', './bundle.js');
    fs.writeFileSync(htmlDest, htmlContent, 'utf8');
  }

  const stats = fs.statSync(outFile);
  console.log(`[Mobile Build] Standalone mobile bundle generated: ${outFile} (${stats.size} bytes)`);
  return outFile;
}

if (process.argv[1] && process.argv[1].endsWith('build-mobile-bundle.ts')) {
  buildMobileBundle().catch(err => {
    console.error('[Mobile Build Error]:', err);
    process.exit(1);
  });
}
