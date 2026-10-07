import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export async function buildClientBundle(): Promise<string> {
  const esbuildPath = path.resolve(rootDir, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js');
  const esbuild = await import('file:///' + esbuildPath.replace(/\\/g, '/'));

  const entryPath = path.resolve(rootDir, 'apps/sovra-app/src/entry.ts');
  const outDir = path.resolve(rootDir, 'apps/sovra-app/dist');
  const outFile = path.join(outDir, 'bundle.js');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('[Build] Compiling and bundling client assets...');
  const result = await esbuild.build({
    entryPoints: [entryPath],
    outfile: outFile,
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'iife',
    globalName: 'SovraApp',
    platform: 'browser',
    target: ['es2022', 'chrome100', 'firefox100', 'safari15'],
    plugins: [
      {
        name: 'node-builtins-shim',
        setup(build: any) {
          build.onResolve({ filter: /^node:(fs|path|crypto|fs\/promises|os|buffer|util|events)/ }, (args: any) => {
            return { path: args.path, namespace: 'node-shim' };
          });
          build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args: any) => {
            if (args.path === 'node:crypto') {
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
            return { contents: 'export default {};', loader: 'js' };
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

  const stats = fs.statSync(outFile);
  console.log(`[Build] Client bundle successfully generated: ${outFile} (${stats.size} bytes)`);
  return outFile;
}

if (process.argv[1] && process.argv[1].endsWith('build-client-bundle.ts')) {
  buildClientBundle().catch(err => {
    console.error('[Build Error]:', err);
    process.exit(1);
  });
}
