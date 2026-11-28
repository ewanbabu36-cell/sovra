/**
 * @file apps/sovra-mobile/build-mobile-bundle.ts
 * Standalone Mobile Hybrid App Production Bundler for Capacitor / Android APK.
 * Syncs compiled dist/bundle.js + dist/index.html directly into android/app/src/main/assets/.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createBrowserNodeShimPlugin } from '../../scripts/esbuild-node-shim.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

function syncBundleAssetsToAndroid(outDir: string): void {
  const androidAssetsDir = path.resolve(__dirname, 'android/app/src/main/assets');
  if (!fs.existsSync(androidAssetsDir)) {
    fs.mkdirSync(androidAssetsDir, { recursive: true });
  }
  for (const fileName of ['index.html', 'bundle.js', 'bundle.js.map']) {
    const srcPath = path.join(outDir, fileName);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(androidAssetsDir, fileName));
    }
  }
  console.log(`[Mobile Build] Synced dist/ assets to ${androidAssetsDir}`);
}

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
      createBrowserNodeShimPlugin({ includeMobileBuiltins: true }),
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

  // Always synchronize dist/ assets into native Android WebView assets directory
  syncBundleAssetsToAndroid(outDir);

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
