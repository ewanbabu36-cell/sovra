import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';

describe('Destructive Backup & Recovery Reliability Drill', () => {
  const cleanupDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const dir = path.resolve(process.cwd(), `.test-${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cleanupDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (_) {}
    }
    cleanupDirs.length = 0;
  });

  // --- DRILL 1: AUTOMATIC RECOVERY FROM PRIMARY FILE CORRUPTION VIA .BAK ---
  it('[DRILL-01] Engine auto-recovers 100% of state from .bak when primary JSON is truncated/corrupted', () => {
    const testDir = createTempDir('drill-01');
    const engine1 = new SovraDatabaseEngine(testDir);

    // Seed state with realistic data
    const userA = engine1.upsertUser({
      did: 'did:key:z6MralicePrimaryDrill',
      handle: '@alice_drill',
      displayName: 'Alice Drill',
      avatar: 'A',
      avatarBg: '#6366f1',
      bio: 'Primary drill user',
      deviceType: 'Desktop',
    });
    expect(userA).toBeDefined();

    const post1 = engine1.createPost({
      authorDid: userA.did,
      authorName: userA.displayName,
      authorAvatar: userA.avatar,
      authorAvatarBg: userA.avatarBg,
      caption: 'Crucial post that must survive catastrophic disk corruption',
      tags: '#reliability #drill',
    });
    expect(post1).toBeDefined();

    engine1.addComment(post1.id, {
      authorDid: userA.did,
      authorName: userA.displayName,
      text: 'Essential comment on post',
    });

    // Ensure save is executed twice so .bak is populated with valid state
    engine1.save();
    engine1.save();

    const paths = engine1.getStoragePaths();
    expect(fs.existsSync(paths.dbFilePath)).toBe(true);
    expect(fs.existsSync(paths.dbBackupPath)).toBe(true);

    const originalContent = fs.readFileSync(paths.dbFilePath, 'utf-8');
    const parsedOriginal = JSON.parse(originalContent);
    expect(parsedOriginal.users.length).toBeGreaterThanOrEqual(1);
    expect(parsedOriginal.posts.length).toBeGreaterThanOrEqual(1);

    // SIMULATE DESTRUCTIVE CORRUPTION: Truncate primary file midway
    fs.writeFileSync(paths.dbFilePath, '{"schemaVersion": 1, "users": [{"did": "corrupted', 'utf-8');

    // Verify file is indeed corrupted
    expect(() => JSON.parse(fs.readFileSync(paths.dbFilePath, 'utf-8'))).toThrow();

    // Instantiate a new engine against the corrupted directory
    const engineRecovered = new SovraDatabaseEngine(testDir);
    const recoveredState = engineRecovered.load();

    // Verify recovery was successful from .bak
    expect(recoveredState.users.some(u => u.did === userA.did)).toBe(true);
    expect(recoveredState.posts.some(p => p.id === post1.id)).toBe(true);

    const integrity = engineRecovered.verifyIntegrity();
    expect(integrity.ok).toBe(true);
    expect(integrity.usersCount).toBeGreaterThanOrEqual(1);
    expect(integrity.postsCount).toBeGreaterThanOrEqual(1);
  });

  // --- DRILL 2: CATASTROPHIC CORRUPTION FALLBACK TO SAFE DEFAULTS ---
  it('[DRILL-02] Catastrophic corruption with no backup falls back to clean schema without crash', () => {
    const testDir = createTempDir('drill-02');
    const dbPath = path.join(testDir, 'dynamic-social-state.json');

    // Create garbage non-JSON file with NO backup file
    fs.writeFileSync(dbPath, '<<<FATAL FILE CORRUPTION RAW NOISE>>>', 'utf-8');

    const engine = new SovraDatabaseEngine(testDir);
    const state = engine.load();

    expect(state).toBeDefined();
    expect(state.schemaVersion).toBe(1);
    expect(Array.isArray(state.users)).toBe(true);
    expect(Array.isArray(state.posts)).toBe(true);
    expect(Array.isArray(state.channels)).toBe(true);

    const integrity = engine.verifyIntegrity();
    expect(integrity.ok).toBe(true);
  });

  // --- DRILL 3: SQLITE ACID INTEGRITY AND VACUUM ONLINE BACKUP ---
  it('[DRILL-03] SQLite engine verifies PRAGMA integrity_check and performs VACUUM online backup', () => {
    const testDir = createTempDir('drill-03');
    const sqliteEngine = new SqliteSocialDatabaseEngine(testDir);

    // Insert user and post
    const regRes = sqliteEngine.registerUser({
      did: 'did:key:z6MrSqliteIntegrityUser',
      handle: '@sqlite_drill',
      displayName: 'SQLite User',
      avatar: 'S',
      avatarBg: '#10b981',
      bio: 'ACID verification',
      deviceType: 'Desktop',
    });
    expect(regRes.ok).toBe(true);
    const user = regRes.user!;
    expect(user.did).toBe('did:key:z6MrSqliteIntegrityUser');

    const post = sqliteEngine.createPost({
      id: 'post-sqlite-drill-1',
      authorDid: user.did,
      authorName: user.displayName,
      authorAvatar: user.avatar,
      authorAvatarBg: user.avatarBg,
      likesCount: 0,
      caption: 'SQLite atomic post',
      tags: '#sqlite #integrity',
      timestamp: Date.now(),
      comments: [],
      likedByDids: [],
    });
    expect(post.id).toBe('post-sqlite-drill-1');

    // Run PRAGMA integrity_check
    const integrityResults = sqliteEngine.checkIntegrity();
    expect(integrityResults).toEqual(['ok']);

    // Perform live online VACUUM backup
    const backupDir = createTempDir('drill-03-backup');
    const backupDbPath = path.join(backupDir, 'sovra-backup.sqlite');
    sqliteEngine.backup(backupDbPath);

    expect(fs.existsSync(backupDbPath)).toBe(true);
    expect(fs.statSync(backupDbPath).size).toBeGreaterThan(0);

    // Verify backup database is independent, readable, and intact
    const backupEngine = new SqliteSocialDatabaseEngine(backupDir);
    // Since backup was created at backupDbPath, let's copy it to sovra-social.sqlite in backupDir to read it
    const targetPath = path.join(backupDir, 'sovra-social.sqlite');
    backupEngine.close();
    fs.copyFileSync(backupDbPath, targetPath);

    const reloadedBackupEngine = new SqliteSocialDatabaseEngine(backupDir);
    const restoredUser = reloadedBackupEngine.findUserByDid(user.did);
    expect(restoredUser).toBeDefined();
    expect(restoredUser?.handle).toBe('@sqlite_drill');

    const restoredPost = reloadedBackupEngine.findPostById(post.id);
    expect(restoredPost).toBeDefined();
    expect(restoredPost?.caption).toBe('SQLite atomic post');

    expect(reloadedBackupEngine.checkIntegrity()).toEqual(['ok']);

    sqliteEngine.close();
    reloadedBackupEngine.close();
  });

  // --- DRILL 4: JSON TO SQLITE MIGRATION INTEGRITY ---
  it('[DRILL-04] Full JSON-to-SQLite migration successfully transfers all records', () => {
    const testDir = createTempDir('drill-04');
    const jsonPath = path.join(testDir, 'source-state.json');

    const sampleState = {
      schemaVersion: 1,
      users: [
        {
          did: 'did:key:z6MrMigrateUser1',
          handle: '@migrated_user1',
          displayName: 'Migrated One',
          avatar: 'M',
          avatarBg: '#f59e0b',
          bio: 'First migrated entity',
          deviceType: 'Mobile',
          createdAt: Date.now() - 5000,
          updatedAt: Date.now(),
        },
      ],
      user_sessions: [
        {
          sessionId: 'sess-migrate-1',
          userDid: 'did:key:z6MrMigrateUser1',
          token: 'stk_migrate_tok_1',
          deviceName: 'Phone',
          deviceType: 'Mobile',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          isValid: true,
        },
      ],
      follows: [],
      posts: [
        {
          id: 'post-migrated-1',
          authorDid: 'did:key:z6MrMigrateUser1',
          authorName: 'Migrated One',
          authorAvatar: 'M',
          authorAvatarBg: '#f59e0b',
          caption: 'Successfully migrated JSON post',
          tags: '#migration #sqlite',
          timestamp: Date.now(),
          likesCount: 1,
          likedByDids: ['did:key:z6MrMigrateUser1'],
          comments: [
            {
              id: 'cmt-migrated-1',
              authorDid: 'did:key:z6MrMigrateUser1',
              authorName: 'Migrated One',
              text: 'Migrated comment',
              timestamp: Date.now(),
              likesCount: 0,
            },
          ],
        },
      ],
      chatMessages: [],
      channels: [],
      friend_relationships: [],
      notifications: [],
      audit_logs: [],
    };

    fs.writeFileSync(jsonPath, JSON.stringify(sampleState, null, 2), 'utf-8');

    const targetSqliteDir = createTempDir('drill-04-sqlite');
    const sqlite = new SqliteSocialDatabaseEngine(targetSqliteDir);

    const migrated = sqlite.migrateFromJson(jsonPath);
    expect(migrated).toBe(true);

    const migratedUser = sqlite.findUserByDid('did:key:z6MrMigrateUser1');
    expect(migratedUser).toBeDefined();
    expect(migratedUser?.handle).toBe('@migrated_user1');

    const migratedPost = sqlite.findPostById('post-migrated-1');
    expect(migratedPost).toBeDefined();
    expect(migratedPost?.caption).toBe('Successfully migrated JSON post');
    expect(migratedPost?.comments.length).toBe(1);
    expect(migratedPost?.comments[0].text).toBe('Migrated comment');

    sqlite.close();
  });
});
