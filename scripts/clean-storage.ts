/**
 * @file scripts/clean-storage.ts
 * Resets local development database to a 100% clean, fresh slate.
 * Purges all test users, audit dummies, mock tips, and test posts,
 * while preserving the node's cryptographic DID identity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const STORAGE_DIR = process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev';

console.log('[CleanStorage] Starting fresh database reset...');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// 1. Files to purge (databases, caches, temp files)
const filesToPurge = [
  'sovra-social.sqlite',
  'sovra-social.sqlite-wal',
  'sovra-social.sqlite-shm',
  'social-graph.sqlite',
  'social-graph.sqlite-wal',
  'social-graph.sqlite-shm',
  'sovra-pins.sqlite',
  'sovra-pins.sqlite-wal',
  'sovra-pins.sqlite-shm',
  'sovra.db',
  'dynamic-social-state.json',
  'dynamic-social-state.json.bak',
  'mobile-client-local-state.json',
  'mobile-client-local-state.json.bak',
];

for (const f of filesToPurge) {
  const p = path.join(STORAGE_DIR, f);
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
      console.log(`[CleanStorage] Removed: ${f}`);
    } catch (err) {
      console.warn(`[CleanStorage] Could not remove ${f}:`, err);
    }
  }
}

// 2. Clean temporary files
const allFiles = fs.readdirSync(STORAGE_DIR);
for (const f of allFiles) {
  if (f.includes('.tmp.') || f.endsWith('.bak')) {
    try {
      fs.unlinkSync(path.join(STORAGE_DIR, f));
      console.log(`[CleanStorage] Removed temp file: ${f}`);
    } catch (_) {}
  }
}

// 3. Clean dummy test media folders while preserving empty folders
const mediaFolders = ['posts', 'reels', 'uploads', 'attachments'];
for (const folder of mediaFolders) {
  const dirPath = path.join(STORAGE_DIR, folder);
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[CleanStorage] Reset media folder: ${folder}/`);
    } catch (err) {
      console.warn(`[CleanStorage] Could not reset media folder ${folder}:`, err);
    }
  } else {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

console.log('[CleanStorage] Initializing fresh schema via SovraDatabaseEngine...');
import('./database-engine.ts').then(async ({ SovraDatabaseEngine }) => {
  const dbEngine = new SovraDatabaseEngine(STORAGE_DIR);
  await dbEngine.load();
  console.log('[CleanStorage] Database reset completed successfully!');
  console.log(`[CleanStorage] Users count: ${dbEngine.getAllUsers().length}`);
  console.log(`[CleanStorage] Posts count: ${dbEngine.getAllPosts().length}`);
  console.log(`[CleanStorage] Channels count: ${dbEngine.getAllChannels().length}`);
  process.exit(0);
}).catch((err) => {
  console.error('[CleanStorage] Error initializing clean database:', err);
  process.exit(1);
});
