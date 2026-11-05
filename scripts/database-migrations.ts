/**
 * Sovra Protocol - Production Database Migration Engine
 * File: scripts/database-migrations.ts
 *
 * Implements deterministic, versioned, transactional, and repeatable migrations
 * for the SQLite WAL embedded database.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  up: (db: DatabaseSync) => void;
  down: (db: DatabaseSync) => void;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: number;
  checksum: string;
}

export const MIGRATIONS: Migration[] = [
  // -------------------------------------------------------------
  // MIGRATION 001: Core Entities (Users, Sessions, Posts, Chats)
  // -------------------------------------------------------------
  {
    version: 1,
    name: '001_core_entities',
    checksum: 'sha256_001_core_entities_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
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

        -- 2. USER SESSIONS
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

        -- 3. FOLLOWS
        CREATE TABLE IF NOT EXISTS follows (
          id TEXT PRIMARY KEY,
          follower_did TEXT NOT NULL,
          target_did TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(follower_did, target_did)
        );
        CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_did);
        CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_did);

        -- 4. POSTS
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
          moderation_state TEXT NOT NULL DEFAULT 'APPROVED',
          moderation_reason TEXT,
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
          moderation_state TEXT NOT NULL DEFAULT 'APPROVED',
          moderation_reason TEXT,
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
          moderation_state TEXT NOT NULL DEFAULT 'APPROVED',
          moderation_reason TEXT,
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
          owner_did TEXT NOT NULL DEFAULT 'did:sovra:system',
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
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS audit_logs;
        DROP TABLE IF EXISTS notifications;
        DROP TABLE IF EXISTS friend_relationships;
        DROP TABLE IF EXISTS channels;
        DROP TABLE IF EXISTS direct_messages;
        DROP TABLE IF EXISTS comments;
        DROP TABLE IF EXISTS posts;
        DROP TABLE IF EXISTS follows;
        DROP TABLE IF EXISTS user_sessions;
        DROP TABLE IF EXISTS users;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 002: Spaces, Groups & Space Membership
  // -------------------------------------------------------------
  {
    version: 2,
    name: '002_spaces_and_groups',
    checksum: 'sha256_002_spaces_groups_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          handle TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          privacy TEXT NOT NULL DEFAULT 'public',
          avatar TEXT NOT NULL,
          bg TEXT NOT NULL,
          member_count INTEGER NOT NULL DEFAULT 1,
          post_approval_required INTEGER NOT NULL DEFAULT 0,
          membership_approval_required INTEGER NOT NULL DEFAULT 0,
          owner_did TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_did);

        CREATE TABLE IF NOT EXISTS space_members (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL,
          space_type TEXT NOT NULL,
          user_did TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at INTEGER NOT NULL,
          UNIQUE(space_id, user_did)
        );
        CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_did);
        CREATE INDEX IF NOT EXISTS idx_space_members_space ON space_members(space_id);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS space_members;
        DROP TABLE IF EXISTS groups;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 003: Reels, Stories & Rich Media Registry
  // -------------------------------------------------------------
  {
    version: 3,
    name: '003_reels_and_stories',
    checksum: 'sha256_003_reels_stories_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reels (
          id TEXT PRIMARY KEY,
          author_did TEXT NOT NULL,
          author_handle TEXT NOT NULL,
          author_name TEXT NOT NULL,
          author_avatar TEXT NOT NULL,
          caption TEXT NOT NULL,
          video_url TEXT NOT NULL,
          audio_track_title TEXT,
          likes_count INTEGER NOT NULL DEFAULT 0,
          comments_count INTEGER NOT NULL DEFAULT 0,
          shares_count INTEGER NOT NULL DEFAULT 0,
          views_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reels_created ON reels(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reels_author ON reels(author_did);

        CREATE TABLE IF NOT EXISTS stories (
          id TEXT PRIMARY KEY,
          author_did TEXT NOT NULL,
          media_type TEXT NOT NULL,
          media_url TEXT NOT NULL,
          caption TEXT,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
        CREATE INDEX IF NOT EXISTS idx_stories_author ON stories(author_did);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS stories;
        DROP TABLE IF EXISTS reels;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 004: Trust, Safety & Moderation Registry
  // -------------------------------------------------------------
  {
    version: 4,
    name: '004_trust_and_safety',
    checksum: 'sha256_004_trust_safety_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          reporter_did TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_author_did TEXT NOT NULL,
          reason TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'PENDING',
          resolution_action TEXT,
          resolved_at INTEGER,
          resolved_by TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
        CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

        CREATE TABLE IF NOT EXISTS mutes (
          id TEXT PRIMARY KEY,
          muter_did TEXT NOT NULL,
          muted_did TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(muter_did, muted_did)
        );
        CREATE INDEX IF NOT EXISTS idx_mutes_muter ON mutes(muter_did);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS mutes;
        DROP TABLE IF EXISTS reports;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 005: Production Performance Indexes & Compaction
  // -------------------------------------------------------------
  {
    version: 5,
    name: '005_performance_indexes',
    checksum: 'sha256_005_perf_indexes_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_posts_vis_created ON posts(visibility, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifs_rec_unread ON notifications(recipient_did, is_read, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dms_thread_time ON direct_messages(thread_id, timestamp DESC);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_dms_thread_time;
        DROP INDEX IF EXISTS idx_notifs_rec_unread;
        DROP INDEX IF EXISTS idx_posts_vis_created;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 006: Community Jury & 24h Moderation Engine
  // -------------------------------------------------------------
  {
    version: 6,
    name: '006_community_jury_moderation',
    checksum: 'sha256_006_community_jury_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS jury_cases (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_url TEXT NOT NULL,
          author_did TEXT NOT NULL,
          author_handle TEXT NOT NULL,
          author_defense_note TEXT,
          author_defense_timestamp INTEGER,
          violation_category TEXT NOT NULL,
          violation_subcategory TEXT,
          evidence_text TEXT NOT NULL,
          evidence_urls_json TEXT NOT NULL DEFAULT '[]',
          is_emergency INTEGER NOT NULL DEFAULT 0,
          emergency_reason TEXT,
          status TEXT NOT NULL DEFAULT 'OPEN_VOTING',
          verdict TEXT,
          verdict_reason TEXT,
          voting_deadline INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          reporters_json TEXT NOT NULL DEFAULT '[]',
          jurors_json TEXT NOT NULL DEFAULT '[]',
          votes_json TEXT NOT NULL DEFAULT '[]',
          vote_stats_json TEXT NOT NULL,
          enforcement_action TEXT,
          enforced_at INTEGER,
          restored_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_jury_cases_status ON jury_cases(status);
        CREATE INDEX IF NOT EXISTS idx_jury_cases_target ON jury_cases(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_jury_cases_author ON jury_cases(author_did);
        CREATE INDEX IF NOT EXISTS idx_jury_cases_deadline ON jury_cases(voting_deadline);

        CREATE TABLE IF NOT EXISTS jury_appeals (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          appellant_did TEXT NOT NULL,
          appellant_role TEXT NOT NULL,
          appeal_reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          review_decision TEXT,
          reviewer_did TEXT,
          resolution_note TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_jury_appeals_case ON jury_appeals(case_id);
        CREATE INDEX IF NOT EXISTS idx_jury_appeals_status ON jury_appeals(status);

        CREATE TABLE IF NOT EXISTS jury_policies (
          id TEXT PRIMARY KEY,
          config_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_by TEXT NOT NULL
        );
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS jury_policies;
        DROP TABLE IF EXISTS jury_appeals;
        DROP TABLE IF EXISTS jury_cases;
      `);
    },
  },

  // -------------------------------------------------------------
  // MIGRATION 007: Phase 4.0 Social Collections (Contacts, Pages, Live, Strikes, Bridge, Orgs)
  // -------------------------------------------------------------
  {
    version: 7,
    name: '007_phase40_social_collections',
    checksum: 'sha256_007_phase40_social_v1',
    up: (db: DatabaseSync) => {
      db.exec(`
        -- 1. CONTACTS & PEERS
        CREATE TABLE IF NOT EXISTS contacts (
          did TEXT PRIMARY KEY,
          handle TEXT,
          name TEXT NOT NULL,
          avatar TEXT NOT NULL DEFAULT '💻',
          avatar_bg TEXT NOT NULL DEFAULT '#6366f1',
          role TEXT NOT NULL DEFAULT 'Desktop Peer',
          device TEXT NOT NULL DEFAULT 'Desktop',
          is_online INTEGER NOT NULL DEFAULT 0,
          last_seen TEXT NOT NULL DEFAULT 'Offline',
          last_seen_timestamp INTEGER NOT NULL,
          disappearing_duration_sec INTEGER NOT NULL DEFAULT 0,
          safety_numbers TEXT,
          is_verified INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_handle ON contacts(handle);
        CREATE INDEX IF NOT EXISTS idx_contacts_online ON contacts(is_online);

        -- 2. PAGES
        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY,
          handle TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          bio TEXT NOT NULL DEFAULT '',
          count INTEGER NOT NULL DEFAULT 0,
          cta TEXT,
          cta_type TEXT,
          avatar TEXT NOT NULL DEFAULT '🏢',
          bg TEXT NOT NULL DEFAULT '#4f46e5',
          is_following INTEGER NOT NULL DEFAULT 0,
          owner_did TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pages_handle ON pages(handle);
        CREATE INDEX IF NOT EXISTS idx_pages_owner ON pages(owner_did);

        -- 3. LIVE SESSIONS
        CREATE TABLE IF NOT EXISTS live_sessions (
          id TEXT PRIMARY KEY,
          creator_did TEXT NOT NULL,
          creator_handle TEXT,
          creator_name TEXT,
          creator_avatar TEXT,
          title TEXT NOT NULL,
          description TEXT,
          stream_url TEXT,
          playback_url TEXT,
          thumbnail_url TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          scheduled_start_time INTEGER,
          viewer_count INTEGER NOT NULL DEFAULT 0,
          peak_viewers INTEGER NOT NULL DEFAULT 0,
          viewers_json TEXT NOT NULL DEFAULT '[]',
          likes_count INTEGER NOT NULL DEFAULT 0,
          tip_total_sov REAL NOT NULL DEFAULT 0.0,
          tips_json TEXT NOT NULL DEFAULT '[]',
          signals_json TEXT NOT NULL DEFAULT '[]',
          category TEXT NOT NULL DEFAULT 'tech',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          actual_start_time INTEGER,
          ended_at INTEGER,
          archive_video_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_live_sessions_creator ON live_sessions(creator_did);
        CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status);

        -- 4. LIVE CHAT MESSAGES
        CREATE TABLE IF NOT EXISTS live_chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          sender_did TEXT NOT NULL,
          sender_handle TEXT,
          sender_name TEXT NOT NULL,
          sender_avatar TEXT NOT NULL DEFAULT '⚡',
          text TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          is_moderator INTEGER NOT NULL DEFAULT 0,
          is_tip INTEGER NOT NULL DEFAULT 0,
          tip_amount REAL NOT NULL DEFAULT 0.0
        );
        CREATE INDEX IF NOT EXISTS idx_live_chat_session ON live_chat_messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_live_chat_timestamp ON live_chat_messages(timestamp);

        -- 5. STRIKES
        CREATE TABLE IF NOT EXISTS strikes (
          id TEXT PRIMARY KEY,
          user_did TEXT NOT NULL,
          strike_level INTEGER NOT NULL DEFAULT 1,
          reason TEXT NOT NULL,
          evidence_report_id TEXT,
          enforced_by_did TEXT,
          signature_hex TEXT,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE INDEX IF NOT EXISTS idx_strikes_user ON strikes(user_did);
        CREATE INDEX IF NOT EXISTS idx_strikes_status ON strikes(status);

        -- 6. BRIDGE TRANSFERS
        CREATE TABLE IF NOT EXISTS bridge_transfers (
          id TEXT PRIMARY KEY,
          tx_hash TEXT UNIQUE NOT NULL,
          sender_address TEXT,
          sender_did TEXT NOT NULL,
          target_chain TEXT NOT NULL,
          target_address TEXT NOT NULL,
          amount TEXT NOT NULL,
          source_asset TEXT NOT NULL DEFAULT 'SOV',
          destination_asset TEXT NOT NULL DEFAULT 'OSMO',
          stages_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'PENDING',
          relayer_fee TEXT,
          created_at INTEGER NOT NULL,
          settled_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_bridge_tx_hash ON bridge_transfers(tx_hash);
        CREATE INDEX IF NOT EXISTS idx_bridge_sender ON bridge_transfers(sender_did);

        -- 7. ORGANIZATIONS
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          handle TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          bio TEXT,
          avatar TEXT NOT NULL DEFAULT '🏢',
          bg TEXT NOT NULL DEFAULT '#3b82f6',
          verified_tier TEXT NOT NULL DEFAULT 'standard',
          owner_did TEXT NOT NULL,
          members_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orgs_handle ON organizations(handle);
        CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(owner_did);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS organizations;
        DROP TABLE IF EXISTS bridge_transfers;
        DROP TABLE IF EXISTS strikes;
        DROP TABLE IF EXISTS live_chat_messages;
        DROP TABLE IF EXISTS live_sessions;
        DROP TABLE IF EXISTS pages;
        DROP TABLE IF EXISTS contacts;
      `);
    },
  },
];

export class SqliteMigrationRunner {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initMigrationTable();
  }

  private initMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
    `);
  }

  public getCurrentVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as any;
    return typeof row?.v === 'number' ? row.v : 0;
  }

  public getAppliedMigrations(): MigrationRecord[] {
    const rows = this.db.prepare('SELECT * FROM schema_migrations ORDER BY version ASC').all() as any[];
    return rows.map(r => ({
      version: r.version,
      name: r.name,
      applied_at: r.applied_at,
      checksum: r.checksum,
    }));
  }

  public getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);
  }

  public applyPending(): { applied: number; currentVersion: number } {
    const pending = this.getPendingMigrations();
    if (pending.length === 0) {
      return { applied: 0, currentVersion: this.getCurrentVersion() };
    }

    let appliedCount = 0;
    for (const mig of pending) {
      this.db.exec('BEGIN TRANSACTION;');
      try {
        mig.up(this.db);
        this.db.prepare(`
          INSERT INTO schema_migrations (version, name, applied_at, checksum)
          VALUES (?, ?, ?, ?)
        `).run(mig.version, mig.name, Date.now(), mig.checksum);
        this.db.exec('COMMIT;');
        appliedCount++;
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw new Error(`Failed to apply migration ${mig.version} (${mig.name}): ${(err as Error).message}`);
      }
    }

    return { applied: appliedCount, currentVersion: this.getCurrentVersion() };
  }

  public rollback(targetVersion: number): { rolledBack: number; currentVersion: number } {
    const applied = this.getAppliedMigrations().sort((a, b) => b.version - a.version);
    const toRollback = applied.filter(m => m.version > targetVersion);

    let rolledBackCount = 0;
    for (const rec of toRollback) {
      const mig = MIGRATIONS.find(m => m.version === rec.version);
      if (!mig) {
        throw new Error(`Cannot rollback migration ${rec.version}: definition not found`);
      }

      this.db.exec('BEGIN TRANSACTION;');
      try {
        mig.down(this.db);
        this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(rec.version);
        this.db.exec('COMMIT;');
        rolledBackCount++;
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw new Error(`Failed to rollback migration ${rec.version} (${rec.name}): ${(err as Error).message}`);
      }
    }

    return { rolledBack: rolledBackCount, currentVersion: this.getCurrentVersion() };
  }

  public verifyIntegrity(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    const applied = this.getAppliedMigrations();
    for (const rec of applied) {
      const def = MIGRATIONS.find(m => m.version === rec.version);
      if (!def) {
        errors.push(`Orphan migration ${rec.version} (${rec.name}) applied in DB but missing from code.`);
      } else if (def.checksum !== rec.checksum) {
        errors.push(`Checksum mismatch for migration ${rec.version}: expected ${def.checksum}, recorded ${rec.checksum}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
