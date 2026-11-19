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
          build.onResolve({ filter: /^(node:)?(fs|path|crypto|net|http|https|tls|dgram|fs\/promises|os|buffer|util|events)/ }, (args: any) => {
            return { path: args.path, namespace: 'node-shim' };
          });
          build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args: any) => {
            if (args.path === 'node:crypto' || args.path === 'crypto') {
              return {
                contents: `
                  const browserCrypto = typeof crypto !== 'undefined' ? crypto : {};
                  export default browserCrypto;
                  export const webcrypto = browserCrypto;
                  export const subtle = browserCrypto.subtle;
                  export function getRandomValues(arr) { return browserCrypto.getRandomValues ? browserCrypto.getRandomValues(arr) : arr; }
                  export function randomUUID() { return browserCrypto.randomUUID ? browserCrypto.randomUUID() : 'uuid-' + Math.random(); }
                  export function randomBytes(size) {
                    const b = new Uint8Array(size);
                    if (browserCrypto.getRandomValues) browserCrypto.getRandomValues(b);
                    return b;
                  }
                  export function createHash() {
                    let d = '';
                    return {
                      update(buf) { d += String(buf); return this; },
                      digest(enc) { return enc === 'hex' ? '00'.repeat(32) : new Uint8Array(32); }
                    };
                  }
                `,
                loader: 'js',
              };
            }
            if (args.path === 'node:net' || args.path === 'net' || args.path === 'node:http' || args.path === 'http' || args.path === 'node:https' || args.path === 'https' || args.path === 'node:tls' || args.path === 'tls') {
              return {
                contents: `
                  export function createServer() { return { listen() {}, on() {}, close() {} }; }
                  export function createConnection() { return { on() {}, write() {}, end() {}, destroy() {} }; }
                  export function connect() { return createConnection(); }
                  export default { createServer, createConnection, connect };
                `,
                loader: 'js',
              };
            }
            if (args.path === 'node:path' || args.path === 'path') {
              return {
                contents: `
                  export function join(...parts) { return parts.filter(Boolean).join('/'); }
                  export function resolve(...parts) { return parts.filter(Boolean).join('/'); }
                  export function dirname(p) { return p.split('/').slice(0, -1).join('/') || '.'; }
                  export function basename(p) { return p.split('/').pop() || ''; }
                  export default { join, resolve, dirname, basename };
                `,
                loader: 'js',
              };
            }
            if (args.path === 'node:fs' || args.path === 'fs' || args.path === 'node:fs/promises' || args.path === 'fs/promises') {
              return {
                contents: `
                  export const promises = {
                    readFile: async () => new Uint8Array(0),
                    writeFile: async () => {},
                    unlink: async () => {},
                    mkdir: async () => {},
                  };
                  export function existsSync() { return false; }
                  export function readFileSync() { return ''; }
                  export function writeFileSync() {}
                  export function mkdirSync() {}
                  export default { promises, existsSync, readFileSync, writeFileSync, mkdirSync };
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

  // Mirror to sovra.bundle.js for modern asset routing
  const sovraOutFile = path.join(outDir, 'sovra.bundle.js');
  fs.copyFileSync(outFile, sovraOutFile);
  if (fs.existsSync(outFile + '.map')) {
    fs.copyFileSync(outFile + '.map', sovraOutFile + '.map');
  }

  // Compile and minify CSS bundle
  const cssEntryPath = path.resolve(rootDir, 'apps/sovra-app/src/styles/sovra.css');
  const outCssFile = path.join(outDir, 'sovra.css');
  if (fs.existsSync(cssEntryPath)) {
    console.log('[Build] Compiling and minifying stylesheet assets...');
    await esbuild.build({
      entryPoints: [cssEntryPath],
      outfile: outCssFile,
      bundle: true,
      minify: true,
      sourcemap: true,
    });
    const cssStats = fs.statSync(outCssFile);
    console.log(`[Build] Stylesheet bundle successfully generated: ${outCssFile} (${cssStats.size} bytes)`);
  }

  return outFile;
}

if (process.argv[1] && process.argv[1].endsWith('build-client-bundle.ts')) {
  buildClientBundle().catch(err => {
    console.error('[Build Error]:', err);
    process.exit(1);
  });
}
