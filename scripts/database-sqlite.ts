/**
 * Sovra Protocol - Production Embedded Relational Engine (SQLite + WAL)
 * File: scripts/database-sqlite.ts
 *
 * Implements a high-concurrency ACID SQL storage engine using Node.js built-in `node:sqlite`.
 * Operates in WAL mode (Write-Ahead Logging) with B-tree indexes, foreign keys, and atomic commits.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type {
  UserRecord,
  PublicUserDTO,
  UserSessionRecord,
  FollowRecord,
  FeedPostRecord,
  FeedComment,
  ChatMessageRecord,
  FriendRelationshipRecord,
  NotificationRecord,
  AuditLogRecord,
  ChannelRecord,
  ReelRecord,
  StoryRecord,
} from './database-engine.ts';

export class SqliteSocialDatabaseEngine {
  private db: DatabaseSync;
  private readonly dbPath: string;
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev';
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.dbPath = path.join(this.storageDir, 'sovra-social.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  public checkpoint(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_) {}
  }

  private initSchema(): void {
    // Configure high-performance WAL mode and safety pragmas
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      -- 1. USERS
      CREATE TABLE IF NOT EXISTS users (
        did TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        name TEXT,
        avatar TEXT NOT NULL,
        avatar_data_url TEXT,
        avatar_bg TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        website_url TEXT NOT NULL DEFAULT '',
        cover_data_url TEXT,
        device_type TEXT NOT NULL DEFAULT 'Desktop',
        public_key TEXT,
        session_token TEXT,
        balance_sov REAL NOT NULL DEFAULT 500.0,
        privacy_settings_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
      CREATE INDEX IF NOT EXISTS idx_users_token ON users(session_token);

      -- 2. USER SESSIONS & HARDWARE DEVICES
      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        device_name TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'Desktop',
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_did) REFERENCES users(did) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_did);

      -- 3. ASYMMETRIC SOCIAL GRAPH (FOLLOWS)
      CREATE TABLE IF NOT EXISTS follows (
        id TEXT PRIMARY KEY,
        follower_did TEXT NOT NULL,
        target_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(follower_did, target_did)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_did);
      CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_did);

      -- 4. POSTS & MULTI-FORMAT FEED
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        handle TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_avatar TEXT NOT NULL,
        author_avatar_bg TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        post_type TEXT NOT NULL DEFAULT 'text',
        media_image TEXT,
        media_video TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        likes_count INTEGER NOT NULL DEFAULT 0,
        comments_count INTEGER NOT NULL DEFAULT 0,
        shares_count INTEGER NOT NULL DEFAULT 0,
        reposts_count INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'public',
        poll_json TEXT,
        article_json TEXT,
        qa_json TEXT,
        quiz_json TEXT,
        mood_json TEXT,
        rating_json TEXT,
        event_json TEXT,
        idea_json TEXT,
        hidden_by_dids_json TEXT NOT NULL DEFAULT '[]',
        saved_by_dids_json TEXT NOT NULL DEFAULT '[]',
        liked_by_dids_json TEXT NOT NULL DEFAULT '[]',
        reactions_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(post_type);

      -- 5. COMMENTS
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        author_handle TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_avatar TEXT NOT NULL,
        author_avatar_bg TEXT NOT NULL,
        text TEXT NOT NULL,
        parent_id TEXT,
        likes_count INTEGER NOT NULL DEFAULT 0,
        liked_by_dids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

      -- 6. DIRECT MESSAGES
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        sender_did TEXT NOT NULL,
        recipient_did TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        is_audio INTEGER NOT NULL DEFAULT 0,
        audio_duration_sec REAL NOT NULL DEFAULT 0,
        waveform_bars_json TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        disappearing_duration_sec INTEGER NOT NULL DEFAULT 0,
        is_bitchat INTEGER NOT NULL DEFAULT 0,
        reactions_json TEXT,
        thread_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON direct_messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON direct_messages(sender_did);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON direct_messages(recipient_did);

      -- 7. CHANNELS
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        desc TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        avatar TEXT NOT NULL,
        bg TEXT NOT NULL,
        is_subbed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- 8. BILATERAL FRIENDSHIPS
      CREATE TABLE IF NOT EXISTS friend_relationships (
        id TEXT PRIMARY KEY,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(from_did, to_did)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_from ON friend_relationships(from_did);
      CREATE INDEX IF NOT EXISTS idx_friends_to ON friend_relationships(to_did);

      -- 9. NOTIFICATIONS
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient_did TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        sender_handle TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_avatar TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        target_id TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_did, is_read);

      -- 10. AUDIT LOGS
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_did TEXT NOT NULL,
        actor_handle TEXT NOT NULL,
        details TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp DESC);
    `);
  }

  /**
   * Automatically migrates legacy JSON state to SQLite if SQLite is empty
   */
  public migrateFromJson(jsonFilePath: string): boolean {
    if (!fs.existsSync(jsonFilePath)) return false;
    const userCount = (this.db.prepare('SELECT COUNT(*) as c FROM users').get() as any)?.c || 0;
    if (userCount > 0) return false; // Already populated

    try {
      const raw = fs.readFileSync(jsonFilePath, 'utf-8');
      const data = JSON.parse(raw);

      this.db.exec('BEGIN TRANSACTION;');

      // Migrate Users
      if (Array.isArray(data.users)) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO users (
            did, handle, display_name, name, avatar, avatar_data_url, avatar_bg,
            bio, website, website_url, cover_data_url, device_type, public_key,
            session_token, balance_sov, privacy_settings_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const u of data.users) {
          stmt.run(
            u.did, u.handle, u.displayName || u.name || 'User', u.name || u.displayName || 'User',
            u.avatar || 'S', u.avatarDataUrl || null, u.avatarBg || '#6366f1',
            u.bio || '', u.website || '', u.websiteUrl || u.website || '',
            u.coverDataUrl || null, u.deviceType || 'Desktop', u.publicKey || null,
            u.sessionToken || null, typeof u.balanceSov === 'number' ? u.balanceSov : 500.0,
            u.privacySettings ? JSON.stringify(u.privacySettings) : null,
            u.createdAt || Date.now(), u.updatedAt || Date.now()
          );
        }
      }

      // Migrate User Sessions
      if (Array.isArray(data.user_sessions)) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO user_sessions (
            session_id, user_did, token, device_name, device_type,
            ip_address, user_agent, created_at, last_active_at, is_revoked
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of data.user_sessions) {
          stmt.run(
            s.sessionId, s.userDid, s.token, s.deviceName, s.deviceType || 'Desktop',
            s.ipAddress || '127.0.0.1', s.userAgent || '', s.createdAt,
            s.lastActiveAt, s.isRevoked ? 1 : 0
          );
        }
      }

      // Migrate Follows
      if (Array.isArray(data.follows)) {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO follows (id, follower_did, target_did, created_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const f of data.follows) {
          stmt.run(f.id || `${f.followerDid}:${f.targetDid}`, f.followerDid, f.targetDid, f.createdAt || Date.now());
        }
      }

      // Migrate Posts
      if (Array.isArray(data.posts)) {
        const postStmt = this.db.prepare(`
          INSERT OR REPLACE INTO posts (
            id, author_did, handle, author_name, author_avatar, author_avatar_bg,
            caption, post_type, media_image, media_video, tags_json,
            likes_count, comments_count, shares_count, reposts_count, visibility,
            poll_json, article_json, qa_json, quiz_json, mood_json, rating_json,
            event_json, idea_json, hidden_by_dids_json, saved_by_dids_json,
            liked_by_dids_json, reactions_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const commentStmt = this.db.prepare(`
          INSERT OR REPLACE INTO comments (
            id, post_id, author_did, author_handle, author_name,
            author_avatar, author_avatar_bg, text, parent_id, likes_count,
            liked_by_dids_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const p of data.posts) {
          const authorHandle = (p as any).handle || (p as any).authorHandle || '';
          const authorName = p.authorName || (p as any).author || 'Peer';
          postStmt.run(
            p.id, p.authorDid, authorHandle, authorName, p.authorAvatar || 'S', p.authorAvatarBg || '#6366f1',
            p.caption || '', p.postType || 'text', p.mediaImage || null, p.mediaVideo || null,
            JSON.stringify(p.tags || []), (p as any).likesCount ?? (p as any).likes ?? 0, Array.isArray(p.comments) ? p.comments.length : 0,
            (p as any).sharesCount ?? (p as any).shares ?? 0, (p as any).repostsCount ?? (p as any).reposts ?? 0, p.visibility || 'public',
            (p as any).poll ? JSON.stringify((p as any).poll) : ((p as any).pollData ? JSON.stringify((p as any).pollData) : null),
            (p as any).article ? JSON.stringify((p as any).article) : ((p as any).articleData ? JSON.stringify((p as any).articleData) : null),
            (p as any).qa ? JSON.stringify((p as any).qa) : ((p as any).qaData ? JSON.stringify((p as any).qaData) : null),
            (p as any).quiz ? JSON.stringify((p as any).quiz) : ((p as any).quizData ? JSON.stringify((p as any).quizData) : null),
            (p as any).mood ? JSON.stringify((p as any).mood) : ((p as any).moodData ? JSON.stringify((p as any).moodData) : null),
            (p as any).rating ? JSON.stringify((p as any).rating) : ((p as any).ratingData ? JSON.stringify((p as any).ratingData) : null),
            (p as any).event ? JSON.stringify((p as any).event) : ((p as any).eventData ? JSON.stringify((p as any).eventData) : null),
            (p as any).idea ? JSON.stringify((p as any).idea) : ((p as any).ideaData ? JSON.stringify((p as any).ideaData) : null),
            JSON.stringify((p as any).hiddenByDids || []),
            JSON.stringify((p as any).savedByDids || []),
            JSON.stringify(p.likedByDids || []),
            JSON.stringify((p as any).reactions || {}),
            p.createdAt || (p as any).timestamp || Date.now(), p.updatedAt || Date.now()
          );

          if (Array.isArray(p.comments)) {
            for (const c of p.comments) {
              const cAuthor = (c as any).author || (c as any).authorName || 'Peer';
              const cHandle = (c as any).authorHandle || (c as any).handle || '';
              commentStmt.run(
                c.id, p.id, (c as any).authorDid || p.authorDid, cHandle, cAuthor,
                (c as any).authorAvatar || 'S', (c as any).authorAvatarBg || '#6366f1',
                c.text || '', (c as any).parentId || null, (c as any).likesCount ?? (c as any).likes ?? 0,
                JSON.stringify((c as any).likedByDids || []), (c as any).createdAt || (c as any).timestamp || Date.now()
              );
            }
          }
        }
      }

      this.db.exec('COMMIT;');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      console.error('[SqliteSocialDB] Migration failed:', err);
      return false;
    }
  }

  // --- USER REPOSITORY ---
  public registerUser(user: Partial<UserRecord>): { ok: boolean; user?: UserRecord; error?: string; code?: number } {
    if (!user.did || !user.handle) {
      return { ok: false, error: 'DID and handle are required', code: 400 };
    }
    const cleanHandle = user.handle.startsWith('@') ? user.handle.toLowerCase() : '@' + user.handle.toLowerCase();

    // Check uniqueness
    const existingHandle = this.findUserByHandle(cleanHandle);
    if (existingHandle) {
      return { ok: false, error: `Handle ${cleanHandle} is already taken`, code: 409 };
    }
    const existingDid = this.findUserByDid(user.did);
    if (existingDid) {
      return { ok: false, error: 'DID is already registered', code: 409 };
    }

    const now = Date.now();
    const token = user.sessionToken || ('stk_' + crypto.randomBytes(24).toString('hex'));
    const record: UserRecord = {
      did: user.did,
      handle: cleanHandle,
      displayName: user.displayName || user.name || cleanHandle.replace('@', ''),
      name: user.name || user.displayName || cleanHandle.replace('@', ''),
      avatar: user.avatar || 'S',
      avatarDataUrl: user.avatarDataUrl,
      avatarBg: user.avatarBg || '#6366f1',
      bio: user.bio || '',
      website: user.website || user.websiteUrl || '',
      websiteUrl: user.websiteUrl || user.website || '',
      coverDataUrl: user.coverDataUrl,
      deviceType: user.deviceType || 'Desktop',
      publicKey: user.publicKey,
      sessionToken: token,
      balanceSov: typeof user.balanceSov === 'number' ? user.balanceSov : 500.0,
      privacySettings: user.privacySettings || {
        profileVisibility: 'public',
        canMessageMe: 'public',
        canSendFriendRequests: 'public',
        showOnlineStatus: true,
        showFollowers: true,
      },
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO users (
        did, handle, display_name, name, avatar, avatar_data_url, avatar_bg,
        bio, website, website_url, cover_data_url, device_type, public_key,
        session_token, balance_sov, privacy_settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.did, record.handle, record.displayName, record.name || null,
      record.avatar, record.avatarDataUrl || null, record.avatarBg,
      record.bio, record.website, record.websiteUrl, record.coverDataUrl || null,
      record.deviceType, record.publicKey || null, record.sessionToken || null,
      record.balanceSov || 500.0, JSON.stringify(record.privacySettings),
      record.createdAt, record.updatedAt
    );

    this.createSession({
      userDid: record.did,
      token,
      deviceName: record.deviceType === 'Mobile' ? 'Mobile Node' : 'Primary Workstation',
      deviceType: record.deviceType as any,
    });

    return { ok: true, user: record };
  }

  public upsertUser(user: Partial<UserRecord>): UserRecord {
    const existing = user.did ? this.findUserByDid(user.did) : undefined;
    if (existing) {
      const merged: UserRecord = {
        ...existing,
        ...user,
        updatedAt: Date.now(),
      } as UserRecord;
      if (user.avatarDataUrl !== undefined && !user.avatarDataUrl) merged.avatarDataUrl = undefined;
      if (user.coverDataUrl !== undefined && !user.coverDataUrl) merged.coverDataUrl = undefined;
      const stmt = this.db.prepare(`
        UPDATE users SET
          display_name = ?, name = ?, avatar = ?, avatar_data_url = ?, avatar_bg = ?,
          bio = ?, website = ?, website_url = ?, cover_data_url = ?, device_type = ?,
          public_key = ?, session_token = ?, balance_sov = ?, privacy_settings_json = ?, updated_at = ?
        WHERE did = ?
      `);
      stmt.run(
        merged.displayName, merged.name || merged.displayName, merged.avatar, merged.avatarDataUrl || null, merged.avatarBg,
        merged.bio, merged.website || '', merged.websiteUrl || '', merged.coverDataUrl || null, merged.deviceType,
        merged.publicKey || null, merged.sessionToken || null, merged.balanceSov ?? 500.0,
        merged.privacySettings ? JSON.stringify(merged.privacySettings) : null, merged.updatedAt, merged.did
      );
      return merged;
    } else {
      const res = this.registerUser(user);
      return res.user!;
    }
  }

  public findUserByDid(did: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE did = ?').get(did) as any;
    if (!row) return undefined;
    return this.mapUserRow(row);
  }

  public findUserByHandle(handle: string): UserRecord | undefined {
    const clean = handle.startsWith('@') ? handle.toLowerCase() : '@' + handle.toLowerCase();
    const row = this.db.prepare('SELECT * FROM users WHERE lower(handle) = ?').get(clean) as any;
    if (!row) return undefined;
    return this.mapUserRow(row);
  }

  public findUserBySessionToken(token: string): UserRecord | undefined {
    if (!token) return undefined;
    if (this.isSessionRevoked(token)) return undefined;

    // Check user_sessions
    const sessRow = this.db.prepare('SELECT user_did FROM user_sessions WHERE token = ? AND is_revoked = 0').get(token) as any;
    if (sessRow) {
      return this.findUserByDid(sessRow.user_did);
    }
    // Fallback to primary session_token
    const userRow = this.db.prepare('SELECT * FROM users WHERE session_token = ?').get(token) as any;
    if (userRow) return this.mapUserRow(userRow);
    return undefined;
  }

  public getAllUsers(): UserRecord[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.mapUserRow(r));
  }

  // --- HARDWARE SESSIONS ---
  public createSession(session: {
    userDid: string;
    token: string;
    deviceName?: string;
    deviceType?: 'Desktop' | 'Mobile' | 'Tablet';
    ipAddress?: string;
    userAgent?: string;
  }): UserSessionRecord {
    const now = Date.now();
    const sessionId = 'ses_' + now + '_' + crypto.randomBytes(6).toString('hex');
    const rec: UserSessionRecord = {
      sessionId,
      userDid: session.userDid,
      token: session.token,
      deviceName: session.deviceName || (session.deviceType === 'Mobile' ? 'Mobile Phone' : 'Workstation Desktop'),
      deviceType: session.deviceType || 'Desktop',
      ipAddress: session.ipAddress || '127.0.0.1',
      userAgent: session.userAgent || 'Sovra Client/1.0',
      createdAt: now,
      lastActiveAt: now,
      isRevoked: false,
    };

    this.db.prepare(`
      INSERT INTO user_sessions (
        session_id, user_did, token, device_name, device_type,
        ip_address, user_agent, created_at, last_active_at, is_revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.sessionId, rec.userDid, rec.token, rec.deviceName, rec.deviceType,
      rec.ipAddress, rec.userAgent, rec.createdAt, rec.lastActiveAt, 0
    );

    return rec;
  }

  public getUserSessions(userDid: string): UserSessionRecord[] {
    const rows = this.db.prepare('SELECT * FROM user_sessions WHERE user_did = ? ORDER BY last_active_at DESC').all(userDid) as any[];
    return rows.map(r => ({
      sessionId: r.session_id,
      userDid: r.user_did,
      token: r.token,
      deviceName: r.device_name,
      deviceType: r.device_type,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
      isRevoked: Boolean(r.is_revoked),
    }));
  }

  public revokeSession(sessionId: string, userDid?: string): boolean {
    let stmt;
    if (userDid) {
      stmt = this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE session_id = ? AND user_did = ?');
      const res = stmt.run(sessionId, userDid);
      return res.changes > 0;
    } else {
      stmt = this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE session_id = ? OR token = ?');
      const res = stmt.run(sessionId, sessionId);
      return res.changes > 0;
    }
  }

  public isSessionRevoked(token: string): boolean {
    const row = this.db.prepare('SELECT is_revoked FROM user_sessions WHERE token = ?').get(token) as any;
    return row ? Boolean(row.is_revoked) : false;
  }

  // --- ASYMMETRIC FOLLOW GRAPH ---
  public followUser(followerDid: string, targetDid: string): { ok: boolean; following: boolean } {
    if (!followerDid || !targetDid || followerDid === targetDid) {
      return { ok: false, following: false };
    }
    const id = `${followerDid}:${targetDid}`;
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO follows (id, follower_did, target_did, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, followerDid, targetDid, Date.now());

      this.addNotification({
        recipientDid: targetDid,
        senderDid: followerDid,
        type: 'FOLLOW',
        title: 'New Follower',
        body: 'A sovereign peer started following you',
      });
      return { ok: true, following: true };
    } catch {
      return { ok: false, following: false };
    }
  }

  public unfollowUser(followerDid: string, targetDid: string): { ok: boolean; following: boolean } {
    const res = this.db.prepare('DELETE FROM follows WHERE follower_did = ? AND target_did = ?').run(followerDid, targetDid);
    return { ok: true, following: false };
  }

  public isFollowing(followerDid: string, targetDid: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM follows WHERE follower_did = ? AND target_did = ?').get(followerDid, targetDid);
    return !!row;
  }

  public getFollowers(targetDid: string): UserRecord[] {
    const rows = this.db.prepare(`
      SELECT u.* FROM users u
      JOIN follows f ON u.did = f.follower_did
      WHERE f.target_did = ?
      ORDER BY f.created_at DESC
    `).all(targetDid) as any[];
    return rows.map(r => this.mapUserRow(r));
  }

  public getFollowing(followerDid: string): UserRecord[] {
    const rows = this.db.prepare(`
      SELECT u.* FROM users u
      JOIN follows f ON u.did = f.target_did
      WHERE f.follower_did = ?
      ORDER BY f.created_at DESC
    `).all(followerDid) as any[];
    return rows.map(r => this.mapUserRow(r));
  }

  public getFollowStats(did: string): { followersCount: number; followingCount: number } {
    const followers = (this.db.prepare('SELECT COUNT(*) as c FROM follows WHERE target_did = ?').get(did) as any)?.c || 0;
    const following = (this.db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_did = ?').get(did) as any)?.c || 0;
    return { followersCount: followers, followingCount: following };
  }

  // --- POSTS ---
  public createPost(post: Partial<FeedPostRecord>): FeedPostRecord {
    const id = post.id || ('post-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
    const now = Date.now();
    const authorUser = post.authorDid ? this.findUserByDid(post.authorDid) : undefined;
    const authorName = post.authorName || authorUser?.displayName || 'Peer';
    const authorHandle = authorUser?.handle || '';
    const authorAvatar = post.authorAvatar || authorUser?.avatar || 'S';
    const authorAvatarBg = post.authorAvatarBg || authorUser?.avatarBg || '#6366f1';

    const rec: FeedPostRecord = {
      id,
      authorDid: post.authorDid || 'did:key:anonymous',
      authorName,
      authorAvatar,
      authorAvatarBg,
      caption: post.caption || '',
      postType: post.postType || 'text',
      mediaImage: post.mediaImage,
      mediaVideo: post.mediaVideo,
      tags: typeof post.tags === 'string' ? post.tags : (Array.isArray(post.tags) ? (post.tags as string[]).join(' ') : ''),
      likesCount: post.likesCount || 0,
      timestamp: post.timestamp || now,
      comments: post.comments || [],
      likedByDids: post.likedByDids || [],
      visibility: post.visibility || 'public',
      sharesCount: post.sharesCount || 0,
      repostsCount: post.repostsCount || 0,
      pollData: post.pollData,
      articleData: post.articleData,
      qaData: post.qaData,
      quizData: post.quizData,
      moodData: post.moodData,
      ratingData: post.ratingData,
      eventData: post.eventData,
      ideaData: post.ideaData,
      hiddenByDids: post.hiddenByDids || [],
      savedByDids: post.savedByDids || [],
    };

    const stmt = this.db.prepare(`
      INSERT INTO posts (
        id, author_did, handle, author_name, author_avatar, author_avatar_bg,
        caption, post_type, media_image, media_video, tags_json,
        likes_count, comments_count, shares_count, reposts_count, visibility,
        poll_json, article_json, qa_json, quiz_json, mood_json, rating_json,
        event_json, idea_json, hidden_by_dids_json, saved_by_dids_json,
        liked_by_dids_json, reactions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      rec.id, rec.authorDid, authorHandle, rec.authorName, rec.authorAvatar, rec.authorAvatarBg,
      rec.caption, rec.postType || 'text', rec.mediaImage || null, rec.mediaVideo || null,
      JSON.stringify(typeof post.tags === 'string' ? post.tags.split(' ') : (post.tags || [])),
      rec.likesCount, rec.comments.length, rec.sharesCount || 0, rec.repostsCount || 0, rec.visibility || 'public',
      rec.pollData ? JSON.stringify(rec.pollData) : null,
      rec.articleData ? JSON.stringify(rec.articleData) : null,
      rec.qaData ? JSON.stringify(rec.qaData) : null,
      rec.quizData ? JSON.stringify(rec.quizData) : null,
      rec.moodData ? JSON.stringify(rec.moodData) : null,
      rec.ratingData ? JSON.stringify(rec.ratingData) : null,
      rec.eventData ? JSON.stringify(rec.eventData) : null,
      rec.ideaData ? JSON.stringify(rec.ideaData) : null,
      JSON.stringify(rec.hiddenByDids || []),
      JSON.stringify(rec.savedByDids || []),
      JSON.stringify(rec.likedByDids), JSON.stringify(rec.reactions || {}), rec.timestamp, now
    );

    return rec;
  }

  public findPostById(id: string): FeedPostRecord | undefined {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    const commentRows = this.db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC').all(id) as any[];
    return this.mapPostRow(row, commentRows);
  }

  private mapPostRow(r: any, comments: any[]): FeedPostRecord {
    let tags = '';
    try {
      const parsedTags = JSON.parse(r.tags_json || '[]');
      tags = Array.isArray(parsedTags) ? parsedTags.join(' ') : String(parsedTags);
    } catch (_) {}

    let pollData, articleData, qaData, quizData, moodData, ratingData, eventData, ideaData;
    let hiddenByDids: string[] = [];
    let savedByDids: string[] = [];
    try { if (r.poll_json) pollData = JSON.parse(r.poll_json); } catch (_) {}
    try { if (r.article_json) articleData = JSON.parse(r.article_json); } catch (_) {}
    try { if (r.qa_json) qaData = JSON.parse(r.qa_json); } catch (_) {}
    try { if (r.quiz_json) quizData = JSON.parse(r.quiz_json); } catch (_) {}
    try { if (r.mood_json) moodData = JSON.parse(r.mood_json); } catch (_) {}
    try { if (r.rating_json) ratingData = JSON.parse(r.rating_json); } catch (_) {}
    try { if (r.event_json) eventData = JSON.parse(r.event_json); } catch (_) {}
    try { if (r.idea_json) ideaData = JSON.parse(r.idea_json); } catch (_) {}
    try { if (r.hidden_by_dids_json) hiddenByDids = JSON.parse(r.hidden_by_dids_json); } catch (_) {}
    try { if (r.saved_by_dids_json) savedByDids = JSON.parse(r.saved_by_dids_json); } catch (_) {}

    return {
      id: r.id,
      authorDid: r.author_did,
      authorName: r.author_name,
      authorAvatar: r.author_avatar,
      authorAvatarBg: r.author_avatar_bg,
      caption: r.caption,
      postType: r.post_type,
      mediaImage: r.media_image || undefined,
      mediaVideo: r.media_video || undefined,
      tags,
      likesCount: r.likes_count,
      timestamp: r.created_at,
      comments: comments.map(c => ({
        id: c.id,
        author: c.author_name,
        authorDid: c.author_did,
        authorAvatar: c.author_avatar,
        text: c.text,
        timestamp: c.created_at,
        likesCount: c.likes_count,
      })),
      likedByDids: JSON.parse(r.liked_by_dids_json || '[]'),
      visibility: r.visibility,
      sharesCount: r.shares_count,
      repostsCount: r.reposts_count,
      pollData,
      articleData,
      qaData,
      quizData,
      moodData,
      ratingData,
      eventData,
      ideaData,
      hiddenByDids,
      savedByDids,
    };
  }

  // --- NOTIFICATIONS ---
  public addNotification(notif: {
    recipientDid: string;
    senderDid: string;
    senderHandle?: string;
    senderName?: string;
    senderAvatar?: string;
    type: string;
    title: string;
    body: string;
    targetId?: string;
  }): NotificationRecord {
    if (notif.recipientDid === notif.senderDid) return {} as any;
    const id = 'notif_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const rec: NotificationRecord = {
      id,
      recipientDid: notif.recipientDid,
      senderDid: notif.senderDid,
      senderHandle: notif.senderHandle || '@peer',
      senderName: notif.senderName || 'Peer',
      senderAvatar: notif.senderAvatar || 'S',
      type: notif.type as any,
      title: notif.title,
      body: notif.body,
      targetId: notif.targetId,
      isRead: false,
      createdAt: Date.now(),
    };

    this.db.prepare(`
      INSERT INTO notifications (
        id, recipient_did, sender_did, sender_handle, sender_name,
        sender_avatar, type, title, body, target_id, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.id, rec.recipientDid, rec.senderDid, rec.senderHandle, rec.senderName,
      rec.senderAvatar, rec.type, rec.title, rec.body, rec.targetId || null, 0, rec.createdAt
    );

    return rec;
  }

  public getNotifications(recipientDid: string): { notifications: NotificationRecord[]; unreadCount: number } {
    const rows = this.db.prepare('SELECT * FROM notifications WHERE recipient_did = ? ORDER BY created_at DESC LIMIT 100').all(recipientDid) as any[];
    const notifs: NotificationRecord[] = rows.map(r => ({
      id: r.id,
      recipientDid: r.recipient_did,
      senderDid: r.sender_did,
      senderHandle: r.sender_handle,
      senderName: r.sender_name,
      senderAvatar: r.sender_avatar,
      type: r.type,
      title: r.title,
      body: r.body,
      targetId: r.target_id,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));
    const unread = notifs.filter(n => !n.isRead).length;
    return { notifications: notifs, unreadCount: unread };
  }

  // --- HELPERS ---
  private mapUserRow(r: any): UserRecord {
    let privacySettings;
    try {
      privacySettings = r.privacy_settings_json ? JSON.parse(r.privacy_settings_json) : undefined;
    } catch (_) {}

    return {
      did: r.did,
      handle: r.handle,
      displayName: r.display_name,
      name: r.name || r.display_name,
      avatar: r.avatar,
      avatarDataUrl: r.avatar_data_url || undefined,
      avatarBg: r.avatar_bg,
      bio: r.bio || '',
      website: r.website || '',
      websiteUrl: r.website_url || r.website || '',
      coverDataUrl: r.cover_data_url || undefined,
      deviceType: r.device_type,
      publicKey: r.public_key || undefined,
      sessionToken: r.session_token || undefined,
      balanceSov: r.balance_sov,
      privacySettings,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public checkIntegrity(): string[] {
    const rows = this.db.prepare('PRAGMA integrity_check').all() as any[];
    return rows.map(r => Object.values(r)[0] as string);
  }

  public backup(destinationPath: string): void {
    const sanitized = destinationPath.replace(/\\/g, '/').replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${sanitized}'`);
  }

  public close(): void {
    this.db.close();
  }
}

