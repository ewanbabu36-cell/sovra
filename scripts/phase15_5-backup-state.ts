import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function copyDirRecursive(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      // Avoid copying write lock files that might be open
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: any) {
        // For active log/LOCK files, read what's readable
        try {
          const buf = fs.readFileSync(srcPath);
          fs.writeFileSync(destPath, buf);
        } catch (readErr: any) {
          console.warn(`Could not copy open file ${srcPath}: ${readErr.message}`);
        }
      }
    }
  }
}

async function createBackup() {
  const src = path.resolve('chain/mytestnet');
  const backupDir = path.resolve('backups/phase15_5_pre_recovery_backup');

  console.log(`Creating secure backup of ${src} to ${backupDir}...`);
  copyDirRecursive(src, backupDir);

  const manifest: { file: string; size: number; sha256: string }[] = [];
  function hashFiles(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full);
      if (entry.isDirectory()) {
        hashFiles(full, base);
      } else {
        const buf = fs.readFileSync(full);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        manifest.push({ file: rel, size: buf.length, sha256: hash });
      }
    }
  }

  hashFiles(backupDir, backupDir);
  const manifestFile = path.resolve('phase15_5-pre-recovery-backup-manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    backupDir,
    totalFiles: manifest.length,
    manifest,
  }, null, 2));

  console.log(`Backup completed successfully! ${manifest.length} files backed up and verified.`);
  console.log(`Manifest written to: ${manifestFile}`);
}

createBackup().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
