import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createBrowserNodeShimPlugin } from './esbuild-node-shim.ts';

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
      createBrowserNodeShimPlugin({ includeMobileBuiltins: false }),
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

  // Sync updated client artifacts & BitSwap SW to embedded sovrad static dir
  const goStaticDir = path.resolve(rootDir, 'chain/cmd/sovrad/static');
  if (fs.existsSync(goStaticDir)) {
    fs.copyFileSync(sovraOutFile, path.join(goStaticDir, 'sovra.bundle.js'));
    if (fs.existsSync(outCssFile)) {
      fs.copyFileSync(outCssFile, path.join(goStaticDir, 'sovra.css'));
    }
    const swSrc = path.resolve(rootDir, 'public/sovra-sw.js');
    if (fs.existsSync(swSrc)) {
      fs.copyFileSync(swSrc, path.join(goStaticDir, 'sovra-sw.js'));
    }
    console.log(`[Build] Synced sovra.bundle.js, sovra.css, sovra-sw.js -> ${goStaticDir}`);
  }

  return outFile;
}

if (process.argv[1] && process.argv[1].endsWith('build-client-bundle.ts')) {
  buildClientBundle().catch(err => {
    console.error('[Build Error]:', err);
    process.exit(1);
  });
}
