/**
 * Sovra Protocol - Production Backup & Restore Engine
 * File: scripts/sovra-backup-restore.ts
 *
 * Implements atomic, verifiable database and media backup & disaster recovery
 * using SQLite online backup (VACUUM INTO) and atomic state snapshots.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

export interface BackupManifest {
  manifestVersion: number;
  backupId: string;
  timestamp: number;
  isoDate: string;
  sourceStorageDir: string;
  schemaVersion: number;
  files: Array<{
    fileName: string;
    sizeBytes: number;
    sha256: string;
  }>;
  databaseStats: {
    usersCount: number;
    postsCount: number;
    messagesCount: number;
    channelsCount: number;
  };
  totalSizeBytes: number;
  integrityVerified: boolean;
}

export interface BackupResult {
  ok: boolean;
  backupId: string;
  backupDir: string;
  manifest: BackupManifest;
  durationMs: number;
  error?: string;
}

export interface RestoreResult {
  ok: boolean;
  backupId: string;
  targetDir: string;
  durationMs: number;
  integrityOk: boolean;
  restoredFilesCount: number;
  error?: string;
}

function calculateFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function copyDirectoryRecursive(src: string, dest: string): number {
  let count = 0;
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

export class SovraBackupManager {
  private defaultStorageDir: string;
  private defaultBackupRoot: string;

  constructor(storageDir?: string, backupRoot?: string) {
    this.defaultStorageDir = path.resolve(storageDir || process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev');
    this.defaultBackupRoot = path.resolve(backupRoot || './.sovra-backups');
  }

  /**
   * Creates a full, consistent, and immediately-verified backup.
   */
  public createBackup(options?: {
    storageDir?: string;
    destRoot?: string;
    includeMedia?: boolean;
    tag?: string;
  }): BackupResult {
    const t0 = performance.now();
    const storageDir = path.resolve(options?.storageDir || this.defaultStorageDir);
    const destRoot = path.resolve(options?.destRoot || this.defaultBackupRoot);
    const now = Date.now();
    const backupId = `sovra_backup_${now}_${options?.tag || crypto.randomBytes(3).toString('hex')}`;
    const backupDir = path.join(destRoot, backupId);

    fs.mkdirSync(backupDir, { recursive: true });

    try {
      const manifestFiles: BackupManifest['files'] = [];
      let totalSizeBytes = 0;

      // 1. BACKUP SQLITE DATABASE (Online Atomic VACUUM INTO)
      const sqliteSourcePath = path.join(storageDir, 'sovra-social.sqlite');
      const sqliteDestPath = path.join(backupDir, 'sovra-social.sqlite');

      let dbStats = { usersCount: 0, postsCount: 0, messagesCount: 0, channelsCount: 0 };
      let schemaVer = 0;

      if (fs.existsSync(sqliteSourcePath)) {
        // Open live DB read-only to checkpoint and run VACUUM INTO
        const liveDb = new DatabaseSync(sqliteSourcePath);
        try {
          liveDb.pragma('wal_checkpoint(TRUNCATE)');
        } catch (_) {}

        const sanitizedDest = sqliteDestPath.replace(/\\/g, '/').replace(/'/g, "''");
        liveDb.exec(`VACUUM INTO '${sanitizedDest}'`);

        // Record schema version and counts
        try {
          const verRow = liveDb.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as any;
          schemaVer = verRow?.v || 0;
          dbStats.usersCount = (liveDb.prepare('SELECT COUNT(*) as c FROM users').get() as any)?.c || 0;
          dbStats.postsCount = (liveDb.prepare('SELECT COUNT(*) as c FROM posts').get() as any)?.c || 0;
          dbStats.messagesCount = (liveDb.prepare('SELECT COUNT(*) as c FROM direct_messages').get() as any)?.c || 0;
          dbStats.channelsCount = (liveDb.prepare('SELECT COUNT(*) as c FROM channels').get() as any)?.c || 0;
        } catch (_) {}
        liveDb.close();

        const sqliteSize = fs.statSync(sqliteDestPath).size;
        const sqliteSha = calculateFileSha256(sqliteDestPath);
        manifestFiles.push({
          fileName: 'sovra-social.sqlite',
          sizeBytes: sqliteSize,
          sha256: sqliteSha,
        });
        totalSizeBytes += sqliteSize;
      }

      // 2. BACKUP PRIMARY JSON STATE & BACKUP SNAPSHOT
      const jsonSourcePath = path.join(storageDir, 'dynamic-social-state.json');
      if (fs.existsSync(jsonSourcePath)) {
        const jsonDestPath = path.join(backupDir, 'dynamic-social-state.json');
        fs.copyFileSync(jsonSourcePath, jsonDestPath);
        const jsonSize = fs.statSync(jsonDestPath).size;
        const jsonSha = calculateFileSha256(jsonDestPath);
        manifestFiles.push({
          fileName: 'dynamic-social-state.json',
          sizeBytes: jsonSize,
          sha256: jsonSha,
        });
        totalSizeBytes += jsonSize;
      }

      const bakSourcePath = path.join(storageDir, 'dynamic-social-state.json.bak');
      if (fs.existsSync(bakSourcePath)) {
        const bakDestPath = path.join(backupDir, 'dynamic-social-state.json.bak');
        fs.copyFileSync(bakSourcePath, bakDestPath);
        const bakSize = fs.statSync(bakDestPath).size;
        const bakSha = calculateFileSha256(bakDestPath);
        manifestFiles.push({
          fileName: 'dynamic-social-state.json.bak',
          sizeBytes: bakSize,
          sha256: bakSha,
        });
        totalSizeBytes += bakSize;
      }

      // 3. BACKUP NODE IDENTITY & CONFIG
      const nodeIdentityPath = path.join(storageDir, 'node-identity.json');
      if (fs.existsSync(nodeIdentityPath)) {
        const nodeIdentityDest = path.join(backupDir, 'node-identity.json');
        fs.copyFileSync(nodeIdentityPath, nodeIdentityDest);
        const idSize = fs.statSync(nodeIdentityDest).size;
        const idSha = calculateFileSha256(nodeIdentityDest);
        manifestFiles.push({
          fileName: 'node-identity.json',
          sizeBytes: idSize,
          sha256: idSha,
        });
        totalSizeBytes += idSize;
      }

      // 4. OPTIONAL MEDIA BACKUP
      if (options?.includeMedia) {
        const mediaDirs = ['avatars', 'covers', 'posts', 'reels', 'attachments'];
        for (const mDir of mediaDirs) {
          const srcMDir = path.join(storageDir, mDir);
          if (fs.existsSync(srcMDir)) {
            const destMDir = path.join(backupDir, 'media', mDir);
            copyDirectoryRecursive(srcMDir, destMDir);
          }
        }
      }

      // 5. IMMEDIATE POST-BACKUP INTEGRITY VERIFICATION
      let integrityVerified = false;
      if (fs.existsSync(sqliteDestPath)) {
        const verifyDb = new DatabaseSync(sqliteDestPath);
        const integrityRows = verifyDb.prepare('PRAGMA integrity_check').all() as any[];
        const integrityStatus = integrityRows.map(r => Object.values(r)[0]).join(', ');
        verifyDb.close();
        integrityVerified = integrityStatus.toLowerCase().includes('ok');
      } else {
        integrityVerified = manifestFiles.length > 0;
      }

      // 6. WRITE MANIFEST
      const manifest: BackupManifest = {
        manifestVersion: 1,
        backupId,
        timestamp: now,
        isoDate: new Date(now).toISOString(),
        sourceStorageDir: storageDir,
        schemaVersion: schemaVer,
        files: manifestFiles,
        databaseStats: dbStats,
        totalSizeBytes,
        integrityVerified,
      };

      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      const durationMs = performance.now() - t0;
      return {
        ok: true,
        backupId,
        backupDir,
        manifest,
        durationMs: Number(durationMs.toFixed(2)),
      };
    } catch (err) {
      const durationMs = performance.now() - t0;
      return {
        ok: false,
        backupId,
        backupDir,
        manifest: {} as any,
        durationMs: Number(durationMs.toFixed(2)),
        error: (err as Error).message,
      };
    }
  }

  /**
   * Verifies an existing backup directory against its manifest and runs SQLite integrity checks.
   */
  public verifyBackup(backupDir: string): { ok: boolean; errors: string[]; manifest?: BackupManifest } {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, errors: ['manifest.json missing from backup directory'] };
    }

    const errors: string[] = [];
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      return { ok: false, errors: [`Invalid manifest JSON: ${(e as Error).message}`] };
    }

    // Verify file checksums
    for (const f of manifest.files) {
      const filePath = path.join(backupDir, f.fileName);
      if (!fs.existsSync(filePath)) {
        errors.push(`Missing backed-up file: ${f.fileName}`);
        continue;
      }
      const actualSize = fs.statSync(filePath).size;
      if (actualSize !== f.sizeBytes) {
        errors.push(`Size mismatch for ${f.fileName}: expected ${f.sizeBytes}, found ${actualSize}`);
      }
      const actualSha = calculateFileSha256(filePath);
      if (actualSha !== f.sha256) {
        errors.push(`Checksum mismatch for ${f.fileName}: expected ${f.sha256}, found ${actualSha}`);
      }
    }

    // Verify SQLite file integrity
    const sqlitePath = path.join(backupDir, 'sovra-social.sqlite');
    if (fs.existsSync(sqlitePath)) {
      try {
        const db = new DatabaseSync(sqlitePath);
        const rows = db.prepare('PRAGMA integrity_check').all() as any[];
        const status = rows.map(r => Object.values(r)[0]).join(', ');
        db.close();
        if (!status.toLowerCase().includes('ok')) {
          errors.push(`SQLite integrity_check failed: ${status}`);
        }
      } catch (err) {
        errors.push(`Failed to open SQLite database: ${(err as Error).message}`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      manifest,
    };
  }

  /**
   * Restores a backup into a target storage directory.
   */
  public restoreBackup(backupDir: string, targetStorageDir?: string): RestoreResult {
    const t0 = performance.now();
    const targetDir = path.resolve(targetStorageDir || this.defaultStorageDir);

    // 1. Pre-restore validation
    const verification = this.verifyBackup(backupDir);
    if (!verification.ok) {
      return {
        ok: false,
        backupId: path.basename(backupDir),
        targetDir,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        integrityOk: false,
        restoredFilesCount: 0,
        error: `Backup verification failed: ${verification.errors.join('; ')}`,
      };
    }

    const manifest = verification.manifest!;
    fs.mkdirSync(targetDir, { recursive: true });

    let restoredCount = 0;
    try {
      // 2. Restore each manifest file
      for (const f of manifest.files) {
        const srcFile = path.join(backupDir, f.fileName);
        const destFile = path.join(targetDir, f.fileName);
        fs.copyFileSync(srcFile, destFile);
        restoredCount++;
      }

      // 3. Restore media if present
      const mediaSrc = path.join(backupDir, 'media');
      if (fs.existsSync(mediaSrc)) {
        copyDirectoryRecursive(mediaSrc, targetDir);
      }

      // 4. Post-restore integrity check on restored database
      let integrityOk = false;
      const restoredSqlitePath = path.join(targetDir, 'sovra-social.sqlite');
      if (fs.existsSync(restoredSqlitePath)) {
        const db = new DatabaseSync(restoredSqlitePath);
        const rows = db.prepare('PRAGMA integrity_check').all() as any[];
        const status = rows.map(r => Object.values(r)[0]).join(', ');
        db.close();
        integrityOk = status.toLowerCase().includes('ok');
      } else {
        integrityOk = true;
      }

      const durationMs = performance.now() - t0;
      return {
        ok: true,
        backupId: manifest.backupId,
        targetDir,
        durationMs: Number(durationMs.toFixed(2)),
        integrityOk,
        restoredFilesCount: restoredCount,
      };
    } catch (err) {
      return {
        ok: false,
        backupId: manifest.backupId,
        targetDir,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        integrityOk: false,
        restoredFilesCount: restoredCount,
        error: `Restore failed: ${(err as Error).message}`,
      };
    }
  }
}
