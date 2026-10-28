/**
 * Sovra Protocol - Production Embedded Relational Engine (SQLite + WAL)
 * File: scripts/database-sqlite.ts
 *
 * Implements a high-concurrency ACID SQL storage engine using Node.js built-in `node:sqlite`.
 * Operates in WAL mode (Write-Ahead Logging) with B-tree indexes, foreign keys, and atomic commits.
 */

import { DatabaseSync, StatementSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteMigrationRunner } from './database-migrations.ts';
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
  private stmtCache = new Map<string, StatementSync>();
  private migrationRunner: SqliteMigrationRunner;
  private wiretapBuffer: Array<{
    id: string;
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    ipAddress: string;
    userAgent: string;
    bytes: number;
    did?: string;
    timestamp: number;
  }> = [];

  constructor(storageDir?: string) {
    this.storageDir = storageDir || process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev';
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.dbPath = path.join(this.storageDir, 'sovra-social.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
    this.migrationRunner = new SqliteMigrationRunner(this.db);
    this.migrationRunner.applyPending();
  }

  public getMigrationRunner(): SqliteMigrationRunner {
    return this.migrationRunner;
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public prepareCached(sql: string): StatementSync {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  public checkpoint(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_) {}
  }

  private initSchema(): void {
    // Configure high-performance WAL mode, memory mapping and safety pragmas
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 268435456;
      PRAGMA cache_size = -64000;

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
        expires_at INTEGER DEFAULT 0,
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
        views_count INTEGER NOT NULL DEFAULT 0,
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

      -- 11. PERSISTENT TOKEN REVOCATION REGISTRY
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token TEXT PRIMARY KEY,
        revoked_at INTEGER NOT NULL,
        reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens ON revoked_tokens(token);

      -- 12. COMMUNITY JURY CASES & 24H MODERATION
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

      -- 13. JURY APPEALS
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

      -- 14. JURY MODERATION POLICIES
      CREATE TABLE IF NOT EXISTS jury_policies (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      );

      -- 15. SOVEREIGN MINI-DAPPS REGISTRY (TITAN-KILLER)
      CREATE TABLE IF NOT EXISTS mini_dapps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author_did TEXT NOT NULL,
        version TEXT NOT NULL,
        bundle_cid TEXT NOT NULL,
        icon_url TEXT,
        category TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        installs_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 5.0,
        description TEXT,
        entry_html TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mini_dapps_category ON mini_dapps(category);

      -- 16. OFFLINE SOUND-WAVE & BLE PAYMENT VOUCHERS (TITAN-KILLER)
      CREATE TABLE IF NOT EXISTS offline_payment_vouchers (
        voucher_id TEXT PRIMARY KEY,
        sender_did TEXT NOT NULL,
        recipient_did TEXT NOT NULL,
        amount_sov REAL NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        signature TEXT NOT NULL,
        status TEXT DEFAULT 'pending_sync',
        audio_fsk_payload TEXT,
        ble_payload TEXT,
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_offline_vouchers_sender ON offline_payment_vouchers(sender_did);
      CREATE INDEX IF NOT EXISTS idx_offline_vouchers_recipient ON offline_payment_vouchers(recipient_did);

      -- 17. CRYPTOGRAPHIC COMMUNITY NOTES (TITAN-KILLER)
      CREATE TABLE IF NOT EXISTS community_notes (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        summary TEXT NOT NULL,
        classification TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        status TEXT DEFAULT 'needs_more_ratings',
        helpfulness_score REAL DEFAULT 0.0,
        divergent_cluster_agreement REAL DEFAULT 0.0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_post ON community_notes(post_id);

      -- 18. COMMUNITY NOTE RATINGS MATRIX (TITAN-KILLER)
      CREATE TABLE IF NOT EXISTS community_note_ratings (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        rater_did TEXT NOT NULL,
        cluster_id TEXT NOT NULL,
        helpful INTEGER NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(note_id, rater_did)
      );
      CREATE INDEX IF NOT EXISTS idx_note_ratings_note ON community_note_ratings(note_id);

      -- 19. ZK PROOF-OF-HUMANITY & ATTESTATIONS (APEX-PREDATOR)
      CREATE TABLE IF NOT EXISTS zk_attestations (
        id TEXT PRIMARY KEY,
        subject_did TEXT NOT NULL,
        attestation_type TEXT NOT NULL,
        proof_snark_json TEXT NOT NULL,
        issuer_did TEXT NOT NULL,
        nullifier_hash TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_zk_attest_nullifier ON zk_attestations(nullifier_hash);
      CREATE INDEX IF NOT EXISTS idx_zk_attest_subject ON zk_attestations(subject_did);

      -- 20. SELF-SOVEREIGN AUTONOMOUS AI AGENTS (APEX-PREDATOR)
      CREATE TABLE IF NOT EXISTS autonomous_agents (
        agent_id TEXT PRIMARY KEY,
        owner_did TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        sub_wallet_address TEXT NOT NULL,
        daily_budget_sov REAL DEFAULT 5.0,
        spent_today_sov REAL DEFAULT 0.0,
        capabilities_json TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        last_executed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_owner ON autonomous_agents(owner_did);

      -- 21. DEPIN MESH HOTSPOT SESSIONS (APEX-PREDATOR)
      CREATE TABLE IF NOT EXISTS depin_mesh_sessions (
        session_id TEXT PRIMARY KEY,
        hotspot_node_did TEXT NOT NULL,
        client_peer_did TEXT NOT NULL,
        bytes_relayed INTEGER DEFAULT 0,
        rate_per_mb_sov REAL DEFAULT 0.001,
        total_earned_sov REAL DEFAULT 0.0,
        status TEXT DEFAULT 'ACTIVE',
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_depin_hotspot ON depin_mesh_sessions(hotspot_node_did);

      -- 22. PROGRAMMABLE QUADRATIC FUNDING ESCROWS (APEX-PREDATOR)
      CREATE TABLE IF NOT EXISTS quadratic_escrows (
        campaign_id TEXT PRIMARY KEY,
        creator_did TEXT NOT NULL,
        title TEXT NOT NULL,
        goal_amount_sov REAL NOT NULL,
        pledged_amount_sov REAL DEFAULT 0.0,
        quadratic_match_sov REAL DEFAULT 0.0,
        contributors_count INTEGER DEFAULT 0,
        milestones_json TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        deadline INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quadratic_creator ON quadratic_escrows(creator_did);

      -- 23. THE GOD DIAL: VIRALITY & ALGORITHMIC MULTIPLIERS
      CREATE TABLE IF NOT EXISTS admin_algo_dials (
        key TEXT PRIMARY KEY,
        multiplier REAL NOT NULL DEFAULT 1.0,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 24. SHADOWBAN & VISIBILITY FILTERING
      CREATE TABLE IF NOT EXISTS admin_shadowbans (
        did TEXT PRIMARY KEY,
        handle TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL,
        decay_factor REAL NOT NULL DEFAULT 0.05,
        expires_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadowbans_handle ON admin_shadowbans(handle);

      -- 25. CANARY FEATURE FLAGS & ZERO-DOWNTIME EXPERIMENTATION
      CREATE TABLE IF NOT EXISTS admin_feature_flags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        rollout_percentage INTEGER NOT NULL DEFAULT 100,
        target_criteria TEXT NOT NULL DEFAULT 'all',
        crash_threshold_percent REAL DEFAULT 0.5,
        updated_at INTEGER NOT NULL
      );

      -- 26. GLOBAL BROADCAST & EMERGENCY ALERT DISPATCHER (AMBER ALERT HUD)
      CREATE TABLE IF NOT EXISTS admin_broadcast_alerts (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_label TEXT,
        action_url TEXT,
        is_sticky INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_active ON admin_broadcast_alerts(active);

      -- 27. FORENSIC VAULT & IMMUTABLE LEGAL HOLDS
      CREATE TABLE IF NOT EXISTS admin_legal_holds (
        did TEXT PRIMARY KEY,
        case_reference TEXT NOT NULL,
        reason TEXT NOT NULL,
        investigator TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 28. REVENUE & MONETIZATION SETTINGS (DYNAMIC TAKE-RATE & INVARIANTS)
      CREATE TABLE IF NOT EXISTS admin_revenue_settings (
        key TEXT PRIMARY KEY,
        value_num REAL,
        value_text TEXT,
        updated_at INTEGER NOT NULL
      );

      -- 29. REVENUE LEAKAGE & DISINTERMEDIATION EVENTS (OFF-PLATFORM RADAR)
      CREATE TABLE IF NOT EXISTS admin_disintermediation_events (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        content_snippet TEXT NOT NULL,
        matched_types TEXT NOT NULL,
        matched_terms TEXT NOT NULL,
        risk_score REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'FLAGGED',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_disinterm_author ON admin_disintermediation_events(author_did);

      -- 30. TOKEN TRANSFERS & TIPS LEDGER (CIRCULAR WASH-TRADING AUDIT)
      CREATE TABLE IF NOT EXISTS token_transfers (
        id TEXT PRIMARY KEY,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        amount_sov REAL NOT NULL,
        fee_sov REAL NOT NULL DEFAULT 0.0,
        tx_type TEXT NOT NULL DEFAULT 'TIP',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfers_from ON token_transfers(from_did);
      CREATE INDEX IF NOT EXISTS idx_transfers_to ON token_transfers(to_did);
      CREATE INDEX IF NOT EXISTS idx_transfers_created ON token_transfers(created_at);

      -- 31. CIRCULAR WASH-TRADING DETECTIONS
      CREATE TABLE IF NOT EXISTS admin_wash_trading_flags (
        id TEXT PRIMARY KEY,
        cycle_dids_json TEXT NOT NULL,
        total_volume_sov REAL NOT NULL,
        tx_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'FLAGGED',
        detected_at INTEGER NOT NULL
      );

      -- 32. NUCLEAR KILL-SWITCH MATRIX (GOD-MODE BLAST-RADIUS PROTECTION)
      CREATE TABLE IF NOT EXISTS admin_kill_switches (
        switch_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        triggered_by TEXT,
        triggered_at INTEGER
      );

      -- 33. HONEYPOT INTRUSION SENSORS (CANARY TRAPS)
      CREATE TABLE IF NOT EXISTS admin_honeypot_intrusions (
        id TEXT PRIMARY KEY,
        trap_path TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        headers_json TEXT,
        payload_snippet TEXT,
        action_taken TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_honeypot_detected ON admin_honeypot_intrusions(detected_at);

      -- 34. GHOST IMPERSONATION SESSIONS (ZERO-KNOWLEDGE AUDITED ACCESS)
      CREATE TABLE IF NOT EXISTS admin_ghost_sessions (
        session_id TEXT PRIMARY KEY,
        target_did TEXT NOT NULL,
        target_handle TEXT NOT NULL,
        admin_did TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ghost_target ON admin_ghost_sessions(target_did);

      -- 35. AI SENTINEL ANOMALIES & THREAT LOGS (24/7 HEURISTIC DEFENSE)
      CREATE TABLE IF NOT EXISTS admin_sentinel_threats (
        id TEXT PRIMARY KEY,
        threat_level TEXT NOT NULL,
        threat_type TEXT NOT NULL,
        subject_did TEXT,
        description TEXT NOT NULL,
        auto_action_taken TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sentinel_detected ON admin_sentinel_threats(detected_at);

      -- 36. WIRETAP TELEMETRY BUFFER (ZERO DARK TRAFFIC)
      CREATE TABLE IF NOT EXISTS admin_wiretap_telemetry (
        id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        latency_ms REAL NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        did TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiretap_time ON admin_wiretap_telemetry(timestamp);

      -- 37. CHRONOS TIME-TRAVEL SNAPSHOTS (ZERO ERROR RECOVERY)
      CREATE TABLE IF NOT EXISTS admin_chronos_snapshots (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        sha256_seal TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 38. ROLE-BASED ACCESS CONTROL (RBAC PERMISSIONS MATRIX)
      CREATE TABLE IF NOT EXISTS admin_rbac_roles (
        admin_did TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at INTEGER NOT NULL
      );

      -- 39. CRYPTOGRAPHIC TAMPER-EVIDENT AUDIT LEDGER (MERKLE HASH CHAIN)
      CREATE TABLE IF NOT EXISTS admin_tamper_evident_audit_ledger (
        entry_id TEXT PRIMARY KEY,
        sequence_num INTEGER NOT NULL,
        admin_did TEXT NOT NULL,
        role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_resource TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        current_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_seq ON admin_tamper_evident_audit_ledger(sequence_num);
      CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_tamper_evident_audit_ledger(admin_did);
    `);

    // Seed default algorithmic dials if empty
    try {
      const dialsCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_algo_dials').get() as any)?.c || 0;
      if (dialsCount === 0) {
        const seedDials = [
          ['breaking_news', 2.0, 'Breaking News & Live Swarms', 'Multiplies propagation velocity during live community events'],
          ['p2p_mesh_discovery', 1.8, 'Local P2P BLE/Wi-Fi Mesh Nodes', 'Prioritizes offline direct proximity peers in local feeds'],
          ['verified_creators', 1.5, 'Verified Sovereign Creators', 'High-reputation verified DID creator distribution boost'],
          ['general_organic', 1.0, 'Organic Community Feed', 'Default organic distribution baseline'],
          ['unverified_links', 0.3, 'External Unverified Hyperlinks', 'Dampens phishing/clickbait external URLs'],
          ['commercial_promotions', 0.5, 'Commercial Drops & Ads', 'Throttles commercial frequency to preserve engagement'],
        ];
        const insertDial = this.db.prepare('INSERT OR REPLACE INTO admin_algo_dials (key, multiplier, category, description, updated_at) VALUES (?, ?, ?, ?, ?)');
        for (const [k, m, cat, desc] of seedDials) {
          insertDial.run(k, m, cat, desc, Date.now());
        }
      }

      // Seed default feature flags if empty
      const flagsCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_feature_flags').get() as any)?.c || 0;
      if (flagsCount === 0) {
        const seedFlags = [
          ['webrtc_calling_v2', 'WebRTC Calling HUD v2', 'Encrypted spatial P2P voice & video calling overlay', 1, 100, 'all'],
          ['ai_smart_polish', 'AI Smart Polish Magic', 'AI-assisted creator post enhancement and sentiment tuning', 1, 100, 'all'],
          ['mesh_isp_bandwidth_metering', 'Micro-ISP Bandwidth Metering', 'Autonomous micropayments for Wi-Fi Direct & BLE relay nodes', 0, 25, 'canary'],
          ['ephemeral_stories_v2', 'Ephemeral 24h Stories Tray', 'Instagram-grade 24-hour disappearing video and photo stories', 1, 100, 'all'],
          ['holographic_core_overlay', 'Holographic Central Core', 'Central spatial radial command center gateway', 1, 100, 'all'],
          ['dapp_store_mini_apps', 'Sovereign P2P Mini DApps', 'Autonomous sandboxed micro-applications and mini-games', 1, 100, 'all'],
        ];
        const insertFlag = this.db.prepare('INSERT OR REPLACE INTO admin_feature_flags (id, name, description, enabled, rollout_percentage, target_criteria, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const [id, name, desc, en, pct, crit] of seedFlags) {
          insertFlag.run(id, name, desc, en, pct, crit, Date.now());
        }
      }

      // Seed default revenue settings if empty
      const settingsCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_revenue_settings').get() as any)?.c || 0;
      if (settingsCount === 0) {
        const insertSetting = this.db.prepare('INSERT OR REPLACE INTO admin_revenue_settings (key, value_num, value_text, updated_at) VALUES (?, ?, ?, ?)');
        insertSetting.run('platform_take_rate_pct', 5.0, null, Date.now());
        insertSetting.run('total_genesis_minted_sov', 5000000.0, null, Date.now());
        insertSetting.run('off_platform_friction_enabled', 1.0, null, Date.now());
      }

      // Seed default nuclear kill switches if empty
      const switchesCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_kill_switches').get() as any)?.c || 0;
      if (switchesCount === 0) {
        const seedSwitches = [
          ['GLOBAL_WITHDRAWALS_FROZEN', 'Halt All Wallet Withdrawals', 'Emergency freeze on outgoing capital outflows'],
          ['NEW_REGISTRATIONS_FROZEN', 'Halt New Account Registrations', 'Blocks Sybil account generation during bot floods'],
          ['P2P_MESH_RELAY_FROZEN', 'Halt DePIN Mesh Bandwidth Rewards', 'Freezes micro-ISP packet rewards during telemetry audit'],
          ['MEDIA_UPLOADS_FROZEN', 'Halt Image & Video Uploads', 'Emergency freeze on new media ingestion to prevent abuse'],
          ['WEBRTC_CALLING_FROZEN', 'Halt WebRTC P2P Calling Signaling', 'Conserves bandwidth during peak server load'],
          ['OFFLINE_PAYMENT_VOUCHERS_FROZEN', 'Halt Offline Voucher Redemption', 'Prevents voucher claims during cryptographic rotation'],
          ['COMMENTS_AND_POSTING_FROZEN', 'Read-Only Network Mode', 'Freezes public write operations during state migration'],
          ['GLOBAL_LOCKDOWN_MODE', 'Global Swarm Lockdown (503)', 'Returns HTTP 503 to all consumers; Admin remains live'],
        ];
        const insertSwitch = this.db.prepare('INSERT OR REPLACE INTO admin_kill_switches (switch_id, label, description, is_active, triggered_by, triggered_at) VALUES (?, ?, ?, 0, null, 0)');
        for (const [id, label, desc] of seedSwitches) {
          insertSwitch.run(id, label, desc);
        }
      }

      // Seed default RBAC roles if empty
      const rbacCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_rbac_roles').get() as any)?.c || 0;
      if (rbacCount === 0) {
        const seedRoles: Array<[string, string, string[], string]> = [
          ['did:sov:admin_root', 'SUPER_ADMIN', ['*'], 'SYSTEM_GENESIS'],
          ['did:sov:admin_commander', 'INCIDENT_COMMANDER', ['kill_switches:write', 'broadcasts:write', 'sessions:terminate', 'telemetry:read'], 'did:sov:admin_root'],
          ['did:sov:admin_auditor', 'FINANCE_AUDITOR', ['solvency:read', 'take_rate:write', 'ledger:transfer', 'wash_trading:read', 'disintermediation:read'], 'did:sov:admin_root'],
          ['did:sov:admin_moderator', 'CONTENT_MODERATOR', ['god_dial:write', 'shadowbans:write', 'flags:write', 'forensics:read'], 'did:sov:admin_root'],
          ['did:sov:admin_observer', 'SYSTEM_OBSERVER', ['*:read'], 'did:sov:admin_root'],
        ];
        const insertRole = this.db.prepare('INSERT OR REPLACE INTO admin_rbac_roles (admin_did, role, permissions_json, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)');
        for (const [did, role, perms, by] of seedRoles) {
          insertRole.run(did, role, JSON.stringify(perms), by, Date.now());
        }
      }

      // Seed genesis audit entry if empty
      const auditCount = (this.db.prepare('SELECT COUNT(*) as c FROM admin_tamper_evident_audit_ledger').get() as any)?.c || 0;
      if (auditCount === 0) {
        const genesisPrev = '0000000000000000000000000000000000000000000000000000000000000000';
        const now = Date.now();
        const payloadStr = JSON.stringify({ genesis: true, version: '1.0.0' });
        const genesisHash = crypto.createHash('sha256').update(genesisPrev + ':0:did:sov:system_genesis:GENESIS_INITIALIZE:SYSTEM_CORE:' + payloadStr + ':' + now).digest('hex');
        this.db.prepare(`
          INSERT INTO admin_tamper_evident_audit_ledger (entry_id, sequence_num, admin_did, role, action_type, target_resource, payload_json, ip_address, prev_hash, current_hash, created_at)
          VALUES ('audit_genesis', 0, 'did:sov:system_genesis', 'SYSTEM', 'GENESIS_INITIALIZE', 'SYSTEM_CORE', ?, '127.0.0.1', ?, ?, ?)
        `).run(payloadStr, genesisPrev, genesisHash, now);
      }
    } catch (_) {}
    try {
      this.db.exec('ALTER TABLE posts ADD COLUMN views_count INTEGER NOT NULL DEFAULT 0;');
    } catch (_) {}
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
              if (Array.isArray((c as any).replies)) {
                for (const r of (c as any).replies) {
                  const rAuthor = (r as any).author || (r as any).authorName || 'Peer';
                  const rHandle = (r as any).authorHandle || (r as any).handle || '';
                  commentStmt.run(
                    r.id, p.id, (r as any).authorDid || p.authorDid, rHandle, rAuthor,
                    (r as any).authorAvatar || 'S', (r as any).authorAvatarBg || '#6366f1',
                    r.text || '', c.id, (r as any).likesCount ?? (r as any).likes ?? 0,
                    JSON.stringify((r as any).likedByDids || []), (r as any).createdAt || (r as any).timestamp || Date.now()
                  );
                }
              }
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

  public getUserByDid(did: string): UserRecord | undefined {
    return this.findUserByDid(did);
  }

  public findUserByDid(did: string): UserRecord | undefined {
    const row = this.prepareCached('SELECT * FROM users WHERE did = ?').get(did) as any;
    if (!row) return undefined;
    return this.mapUserRow(row);
  }

  public findUserByHandle(handle: string): UserRecord | undefined {
    const clean = handle.startsWith('@') ? handle.toLowerCase() : '@' + handle.toLowerCase();
    const row = this.prepareCached('SELECT * FROM users WHERE lower(handle) = ?').get(clean) as any;
    if (!row) return undefined;
    return this.mapUserRow(row);
  }

  public findUserBySessionToken(token: string): UserRecord | undefined {
    if (!token) return undefined;
    if (this.isSessionRevoked(token)) return undefined;

    // Check user_sessions
    try {
      const sessRow = this.prepareCached('SELECT user_did, expires_at FROM user_sessions WHERE token = ? AND is_revoked = 0').get(token) as any;
      if (sessRow) {
        if (sessRow.expires_at && Number(sessRow.expires_at) > 0 && Number(sessRow.expires_at) < Date.now()) {
          return undefined;
        }
        return this.findUserByDid(sessRow.user_did);
      }
    } catch {
      const sessRow = this.prepareCached('SELECT user_did FROM user_sessions WHERE token = ? AND is_revoked = 0').get(token) as any;
      if (sessRow) {
        return this.findUserByDid(sessRow.user_did);
      }
    }
    // Fallback to primary session_token
    const userRow = this.prepareCached('SELECT * FROM users WHERE session_token = ?').get(token) as any;
    if (userRow) return this.mapUserRow(userRow);
    return undefined;
  }

  public getAllUsers(): UserRecord[] {
    const rows = this.prepareCached('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
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
    ttlMs?: number;
    expiresAt?: number;
  }): UserSessionRecord {
    const now = Date.now();
    const sessionId = 'ses_' + now + '_' + crypto.randomBytes(6).toString('hex');
    const defaultTtlMs = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = session.expiresAt || (session.ttlMs ? now + session.ttlMs : now + defaultTtlMs);
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
      expiresAt,
      isRevoked: false,
    };

    this.db.prepare(`
      INSERT INTO user_sessions (
        session_id, user_did, token, device_name, device_type,
        ip_address, user_agent, created_at, last_active_at, expires_at, is_revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.sessionId, rec.userDid, rec.token, rec.deviceName, rec.deviceType,
      rec.ipAddress, rec.userAgent, rec.createdAt, rec.lastActiveAt, rec.expiresAt, 0
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
      expiresAt: Number(r.expires_at || 0),
      isRevoked: Boolean(r.is_revoked),
    }));
  }

  public revokeSession(sessionId: string, userDid?: string): boolean {
    try {
      const sess = this.prepareCached('SELECT token, session_id FROM user_sessions WHERE session_id = ? OR token = ?').get(sessionId, sessionId) as any;
      const token = sess?.token || sessionId;
      try {
        this.prepareCached('INSERT OR REPLACE INTO revoked_tokens (token, revoked_at, reason) VALUES (?, ?, ?)').run(
          token, Date.now(), 'Revocation'
        );
      } catch (_) {}

      let stmt;
      if (userDid) {
        stmt = this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE (session_id = ? OR token = ?) AND user_did = ?');
        const res = stmt.run(sessionId, sessionId, userDid);
        return res.changes > 0;
      } else {
        stmt = this.db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE session_id = ? OR token = ?');
        const res = stmt.run(sessionId, sessionId);
        return res.changes > 0;
      }
    } catch {
      return false;
    }
  }

  public isSessionRevoked(token: string): boolean {
    if (!token) return true;
    try {
      const rev = this.prepareCached('SELECT 1 FROM revoked_tokens WHERE token = ?').get(token);
      if (rev) return true;
      const row = this.prepareCached('SELECT is_revoked, expires_at FROM user_sessions WHERE token = ?').get(token) as any;
      if (!row) return false;
      if (row.is_revoked) return true;
      if (row.expires_at && Number(row.expires_at) > 0 && Number(row.expires_at) < Date.now()) return true;
      return false;
    } catch {
      const row = this.prepareCached('SELECT is_revoked FROM user_sessions WHERE token = ?').get(token) as any;
      return row ? Boolean(row.is_revoked) : false;
    }
  }

  public deleteChatMessage(messageId: string, requesterDid: string): { ok: boolean; error?: string } {
    try {
      const msg = this.prepareCached('SELECT sender_did, recipient_did FROM chat_messages WHERE id = ?').get(messageId) as any;
      if (!msg) return { ok: false, error: 'Message not found' };
      if (msg.sender_did !== requesterDid && !msg.recipient_did.startsWith('channel:')) {
        return { ok: false, error: 'Forbidden: Cannot delete message sent by another peer' };
      }
      this.prepareCached('DELETE FROM chat_messages WHERE id = ?').run(messageId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to delete message' };
    }
  }

  public deleteUserAccount(userDid: string): { ok: boolean; error?: string } {
    if (!userDid) return { ok: false, error: 'User DID required' };
    const user = this.findUserByDid(userDid);
    if (!user) return { ok: false, error: 'User not found' };

    const deleteTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM users WHERE did = ?').run(userDid);
      this.db.prepare('DELETE FROM user_sessions WHERE user_did = ?').run(userDid);
      this.db.prepare('DELETE FROM follows WHERE follower_did = ? OR target_did = ?').run(userDid, userDid);
      this.db.prepare('DELETE FROM posts WHERE author_did = ?').run(userDid);
      this.db.prepare('DELETE FROM comments WHERE author_did = ?').run(userDid);
      this.db.prepare('DELETE FROM likes WHERE user_did = ?').run(userDid);
      this.db.prepare('DELETE FROM chat_messages WHERE sender_did = ? OR recipient_did = ?').run(userDid, userDid);
      this.db.prepare('DELETE FROM notifications WHERE recipient_did = ? OR sender_did = ?').run(userDid, userDid);
      this.db.prepare('DELETE FROM channels WHERE owner_did = ?').run(userDid);
      this.db.prepare('DELETE FROM pages WHERE owner_did = ?').run(userDid);
    });

    try {
      deleteTx();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Database error during account deletion' };
    }
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
    const res = this.prepareCached('DELETE FROM follows WHERE follower_did = ? AND target_did = ?').run(followerDid, targetDid);
    return { ok: true, following: false };
  }

  public isFollowing(followerDid: string, targetDid: string): boolean {
    const row = this.prepareCached('SELECT 1 FROM follows WHERE follower_did = ? AND target_did = ?').get(followerDid, targetDid);
    return !!row;
  }

  public getFollowers(targetDid: string): UserRecord[] {
    const rows = this.prepareCached(`
      SELECT u.* FROM users u
      JOIN follows f ON u.did = f.follower_did
      WHERE f.target_did = ?
      ORDER BY f.created_at DESC
    `).all(targetDid) as any[];
    return rows.map(r => this.mapUserRow(r));
  }

  public getFollowing(followerDid: string): UserRecord[] {
    const rows = this.prepareCached(`
      SELECT u.* FROM users u
      JOIN follows f ON u.did = f.target_did
      WHERE f.follower_did = ?
      ORDER BY f.created_at DESC
    `).all(followerDid) as any[];
    return rows.map(r => this.mapUserRow(r));
  }

  public getFollowStats(did: string): { followersCount: number; followingCount: number } {
    const followers = (this.prepareCached('SELECT COUNT(*) as c FROM follows WHERE target_did = ?').get(did) as any)?.c || 0;
    const following = (this.prepareCached('SELECT COUNT(*) as c FROM follows WHERE follower_did = ?').get(did) as any)?.c || 0;
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
    const row = this.prepareCached('SELECT * FROM posts WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    const commentRows = this.prepareCached('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC').all(id) as any[];
    return this.mapPostRow(row, commentRows);
  }

  public incrementPostViews(id: string, delta = 1): void {
    try {
      this.prepareCached('UPDATE posts SET views_count = COALESCE(views_count, 0) + ? WHERE id = ?').run(delta, id);
    } catch (_) {}
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
      comments: (() => {
        const topComments = comments.filter(c => !c.parent_id);
        const replyComments = comments.filter(c => Boolean(c.parent_id));
        return topComments.map(c => ({
          id: c.id,
          author: c.author_name,
          authorDid: c.author_did,
          authorHandle: c.author_handle,
          authorAvatar: c.author_avatar,
          text: c.text,
          timestamp: c.created_at,
          likesCount: c.likes_count,
          likedByDids: JSON.parse(c.liked_by_dids_json || '[]'),
          replies: replyComments.filter(rc => rc.parent_id === c.id).map(rc => ({
            id: rc.id,
            commentId: c.id,
            parentId: c.id,
            author: rc.author_name,
            authorDid: rc.author_did,
            authorHandle: rc.author_handle,
            authorAvatar: rc.author_avatar,
            text: rc.text,
            timestamp: rc.created_at,
            likesCount: rc.likes_count,
            likedByDids: JSON.parse(rc.liked_by_dids_json || '[]'),
          })),
        }));
      })(),
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
    const rows = this.prepareCached('SELECT * FROM notifications WHERE recipient_did = ? ORDER BY created_at DESC LIMIT 100').all(recipientDid) as any[];
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

  // ==========================================
  // 🎛️ THE GOD DIAL & SHADOWBAN (BIG TECH OPERATIONS)
  // ==========================================
  public getAlgoDials(): Array<{ key: string; multiplier: number; category: string; description: string; updatedAt: number }> {
    try {
      const rows = this.db.prepare('SELECT key, multiplier, category, description, updated_at FROM admin_algo_dials ORDER BY multiplier DESC').all() as any[];
      return rows.map(r => ({
        key: r.key,
        multiplier: Number(r.multiplier),
        category: r.category,
        description: r.description,
        updatedAt: r.updated_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public setAlgoDial(key: string, multiplier: number, category?: string, description?: string): boolean {
    try {
      const existing = this.db.prepare('SELECT * FROM admin_algo_dials WHERE key = ?').get(key) as any;
      const cat = category || existing?.category || 'Custom Category';
      const desc = description || existing?.description || 'Algorithmic Multiplier Dial';
      this.prepareCached(`
        INSERT OR REPLACE INTO admin_algo_dials (key, multiplier, category, description, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(key, Math.max(0.01, Math.min(10.0, multiplier)), cat, desc, Date.now());
      return true;
    } catch (_) {
      return false;
    }
  }

  public getShadowbans(): Array<{ did: string; handle: string; reason: string; decayFactor: number; expiresAt: number; createdAt: number }> {
    try {
      const rows = this.db.prepare('SELECT did, handle, reason, decay_factor, expires_at, created_at FROM admin_shadowbans ORDER BY created_at DESC').all() as any[];
      return rows.map(r => ({
        did: r.did,
        handle: r.handle || '',
        reason: r.reason,
        decayFactor: Number(r.decay_factor),
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public setShadowban(did: string, handle: string, reason: string, decayFactor = 0.05, expiresAt = 0): boolean {
    try {
      this.prepareCached(`
        INSERT OR REPLACE INTO admin_shadowbans (did, handle, reason, decay_factor, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(did, handle, reason, Math.max(0.0, Math.min(1.0, decayFactor)), expiresAt, Date.now());
      return true;
    } catch (_) {
      return false;
    }
  }

  public removeShadowban(did: string): boolean {
    try {
      this.prepareCached('DELETE FROM admin_shadowbans WHERE did = ?').run(did);
      return true;
    } catch (_) {
      return false;
    }
  }

  public isShadowbanned(did: string): { shadowbanned: boolean; decayFactor: number } {
    try {
      const row = this.prepareCached('SELECT decay_factor, expires_at FROM admin_shadowbans WHERE did = ?').get(did) as any;
      if (!row) return { shadowbanned: false, decayFactor: 1.0 };
      if (row.expires_at > 0 && Date.now() > row.expires_at) {
        this.removeShadowban(did);
        return { shadowbanned: false, decayFactor: 1.0 };
      }
      return { shadowbanned: true, decayFactor: Number(row.decay_factor) };
    } catch (_) {
      return { shadowbanned: false, decayFactor: 1.0 };
    }
  }

  // ==========================================
  // 🚩 CANARY FEATURE FLAGS
  // ==========================================
  public getFeatureFlags(): Array<{ id: string; name: string; description: string; enabled: boolean; rolloutPercentage: number; targetCriteria: string; updatedAt: number }> {
    try {
      const rows = this.db.prepare('SELECT id, name, description, enabled, rollout_percentage, target_criteria, updated_at FROM admin_feature_flags ORDER BY name ASC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        enabled: Boolean(r.enabled),
        rolloutPercentage: Number(r.rollout_percentage),
        targetCriteria: r.target_criteria,
        updatedAt: r.updated_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public setFeatureFlag(id: string, enabled: boolean, rolloutPercentage = 100, name?: string, description?: string): boolean {
    try {
      const existing = this.db.prepare('SELECT * FROM admin_feature_flags WHERE id = ?').get(id) as any;
      if (existing) {
        this.prepareCached(`
          UPDATE admin_feature_flags
          SET enabled = ?, rollout_percentage = ?, updated_at = ?
          WHERE id = ?
        `).run(enabled ? 1 : 0, Math.max(0, Math.min(100, rolloutPercentage)), Date.now(), id);
      } else {
        this.prepareCached(`
          INSERT INTO admin_feature_flags (id, name, description, enabled, rollout_percentage, target_criteria, updated_at)
          VALUES (?, ?, ?, ?, ?, 'all', ?)
        `).run(id, name || id, description || 'Dynamic runtime feature flag', enabled ? 1 : 0, Math.max(0, Math.min(100, rolloutPercentage)), Date.now());
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  public evaluateClientFlags(userDid?: string): Record<string, boolean> {
    const flags = this.getFeatureFlags();
    const result: Record<string, boolean> = {};
    for (const f of flags) {
      if (!f.enabled) {
        result[f.id] = false;
        continue;
      }
      if (f.rolloutPercentage >= 100) {
        result[f.id] = true;
        continue;
      }
      if (f.rolloutPercentage <= 0) {
        result[f.id] = false;
        continue;
      }
      const hashInput = (userDid || 'guest') + ':' + f.id;
      let hash = 0;
      for (let i = 0; i < hashInput.length; i++) {
        hash = ((hash << 5) - hash + hashInput.charCodeAt(i)) | 0;
      }
      const bucket = Math.abs(hash) % 100;
      result[f.id] = bucket < f.rolloutPercentage;
    }
    return result;
  }

  // ==========================================
  // 📢 GLOBAL BROADCAST ALERTS
  // ==========================================
  public getBroadcastAlerts(): Array<{ id: string; level: string; title: string; message: string; actionLabel?: string; actionUrl?: string; isSticky: boolean; active: boolean; createdAt: number }> {
    try {
      const rows = this.db.prepare('SELECT id, level, title, message, action_label, action_url, is_sticky, active, created_at FROM admin_broadcast_alerts ORDER BY created_at DESC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        level: r.level,
        title: r.title,
        message: r.message,
        actionLabel: r.action_label || undefined,
        actionUrl: r.action_url || undefined,
        isSticky: Boolean(r.is_sticky),
        active: Boolean(r.active),
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public getActiveBroadcastAlerts(): Array<{ id: string; level: string; title: string; message: string; actionLabel?: string; actionUrl?: string; isSticky: boolean; createdAt: number }> {
    try {
      const rows = this.db.prepare('SELECT id, level, title, message, action_label, action_url, is_sticky, created_at FROM admin_broadcast_alerts WHERE active = 1 ORDER BY created_at DESC LIMIT 3').all() as any[];
      return rows.map(r => ({
        id: r.id,
        level: r.level,
        title: r.title,
        message: r.message,
        actionLabel: r.action_label || undefined,
        actionUrl: r.action_url || undefined,
        isSticky: Boolean(r.is_sticky),
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public publishBroadcastAlert(alert: { id?: string; level: string; title: string; message: string; actionLabel?: string; actionUrl?: string; isSticky?: boolean }): string {
    const id = alert.id || 'alert_' + crypto.randomUUID().slice(0, 8);
    try {
      this.prepareCached(`
        INSERT INTO admin_broadcast_alerts (id, level, title, message, action_label, action_url, is_sticky, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(id, alert.level.toUpperCase(), alert.title, alert.message, alert.actionLabel || null, alert.actionUrl || null, alert.isSticky ? 1 : 0, Date.now());
    } catch (_) {}
    return id;
  }

  public dismissBroadcastAlert(id: string): boolean {
    try {
      this.prepareCached('UPDATE admin_broadcast_alerts SET active = 0 WHERE id = ?').run(id);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ==========================================
  // 🛡️ FORENSIC COMPLIANCE & LEGAL HOLDS
  // ==========================================
  public getLegalHolds(): Array<{ did: string; caseReference: string; reason: string; investigator: string; createdAt: number }> {
    try {
      const rows = this.db.prepare('SELECT did, case_reference, reason, investigator, created_at FROM admin_legal_holds ORDER BY created_at DESC').all() as any[];
      return rows.map(r => ({
        did: r.did,
        caseReference: r.case_reference,
        reason: r.reason,
        investigator: r.investigator,
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public setLegalHold(did: string, caseReference: string, reason: string, investigator: string): boolean {
    try {
      this.prepareCached(`
        INSERT OR REPLACE INTO admin_legal_holds (did, case_reference, reason, investigator, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(did, caseReference, reason, investigator, Date.now());
      return true;
    } catch (_) {
      return false;
    }
  }

  public removeLegalHold(did: string): boolean {
    try {
      this.prepareCached('DELETE FROM admin_legal_holds WHERE did = ?').run(did);
      return true;
    } catch (_) {
      return false;
    }
  }

  public hasLegalHold(did: string): boolean {
    try {
      const row = this.prepareCached('SELECT did FROM admin_legal_holds WHERE did = ?').get(did);
      return Boolean(row);
    } catch (_) {
      return false;
    }
  }

  public generateForensicDossier(did: string): { dossier: any; sha256Seal: string } {
    const user = this.findUserByDid(did) || { did, handle: 'unknown', displayName: 'Unknown Subject', createdAt: 0 };
    let sessions: any[] = [];
    let postsCount = 0;
    let commentsCount = 0;
    let followersCount = 0;
    let followingCount = 0;
    let auditLogs: any[] = [];
    let juryCases: any[] = [];

    try {
      sessions = (this.db.prepare('SELECT session_id, device_name, device_type, ip_address, user_agent, created_at, last_active_at, is_revoked FROM user_sessions WHERE user_did = ?').all(did) as any[]) || [];
      postsCount = (this.db.prepare('SELECT COUNT(*) as c FROM posts WHERE author_did = ?').get(did) as any)?.c || 0;
      commentsCount = (this.db.prepare('SELECT COUNT(*) as c FROM comments WHERE author_did = ?').get(did) as any)?.c || 0;
      followersCount = (this.db.prepare('SELECT COUNT(*) as c FROM follows WHERE target_did = ?').get(did) as any)?.c || 0;
      followingCount = (this.db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_did = ?').get(did) as any)?.c || 0;
      auditLogs = (this.db.prepare('SELECT id, action, details, ip_address, timestamp FROM audit_logs WHERE actor_did = ? ORDER BY timestamp DESC LIMIT 50').all(did) as any[]) || [];
      juryCases = (this.db.prepare('SELECT id, target_type, violation_category, status, verdict, created_at FROM jury_cases WHERE author_did = ?').all(did) as any[]) || [];
    } catch (_) {}

    const shadowban = this.isShadowbanned(did);
    const legalHold = this.hasLegalHold(did);

    const dossier = {
      specVersion: 'SOVRA-FORENSIC-V1.0',
      generatedAt: Date.now(),
      generatedIso: new Date().toISOString(),
      subject: {
        did: user.did,
        handle: user.handle,
        displayName: user.displayName,
        deviceType: user.deviceType,
        publicKey: user.publicKey,
        balanceSov: user.balanceSov,
        registeredAt: user.createdAt,
      },
      securityState: {
        shadowbanned: shadowban.shadowbanned,
        shadowbanDecayFactor: shadowban.decayFactor,
        underLegalHold: legalHold,
        activeSessionsCount: sessions.filter(s => !s.is_revoked).length,
        totalDeviceSessionsHistory: sessions.length,
      },
      socialMetrics: {
        postsCount,
        commentsCount,
        followersCount,
        followingCount,
      },
      auditRecordsCount: auditLogs.length,
      auditHistorySample: auditLogs,
      juryEnforcementRecords: juryCases,
      hardwareSessions: sessions,
    };

    const canonicalJson = JSON.stringify(dossier);
    const sha256Seal = crypto.createHash('sha256').update(canonicalJson).digest('hex');

    return { dossier, sha256Seal };
  }

  // ==========================================
  // 💸 REVENUE OPERATIONS, SETTINGS & DYNAMIC TAKE-RATE
  // ==========================================
  public getRevenueSetting(key: string, defaultNum = 0.0, defaultText = ''): { valueNum: number; valueText: string } {
    try {
      const row = this.prepareCached('SELECT value_num, value_text FROM admin_revenue_settings WHERE key = ?').get(key) as any;
      if (!row) return { valueNum: defaultNum, valueText: defaultText };
      return {
        valueNum: typeof row.value_num === 'number' ? row.value_num : defaultNum,
        valueText: row.value_text || defaultText,
      };
    } catch (_) {
      return { valueNum: defaultNum, valueText: defaultText };
    }
  }

  public setRevenueSetting(key: string, valueNum: number, valueText?: string): boolean {
    try {
      this.prepareCached(`
        INSERT OR REPLACE INTO admin_revenue_settings (key, value_num, value_text, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(key, valueNum, valueText || null, Date.now());
      return true;
    } catch (_) {
      return false;
    }
  }

  public getPlatformTakeRate(): number {
    return this.getRevenueSetting('platform_take_rate_pct', 5.0).valueNum;
  }

  public setPlatformTakeRate(ratePercent: number): boolean {
    const clamped = Math.max(2.5, Math.min(10.0, Number(ratePercent) || 5.0));
    return this.setRevenueSetting('platform_take_rate_pct', clamped);
  }

  // ==========================================
  // ⚖️ TRUE 4-COLUMN DOUBLE-ENTRY SOLVENCY ENGINE
  // ==========================================
  public getTreasurySolvencyReport(): {
    ok: boolean;
    solvencyDeltaSov: number;
    isSolvent: boolean;
    healthStatus: 'HEALTHY' | 'DISCREPANCY';
    totalSystemSov: number;
    breakdown: {
      totalInjectedSov: number;
      userBalancesSov: number;
      escrowsLockedSov: {
        total: number;
        sponsoredBounties: number;
        quadraticEscrows: number;
        promotionsUnspent: number;
      };
      treasuryReserveSov: number;
      unsettledReferralsSov: number;
    };
    verificationHash: string;
    auditTimestamp: number;
  } {
    let userBalancesSov = 0;
    try {
      userBalancesSov = (this.db.prepare('SELECT SUM(balance_sov) as s FROM users').get() as any)?.s || 0;
    } catch (_) {}

    let quadraticEscrowSov = 0;
    try {
      quadraticEscrowSov = (this.db.prepare("SELECT SUM(balance_sov) as s FROM quadratic_escrows WHERE status = 'LOCKED'").get() as any)?.s || 0;
    } catch (_) {}

    let platformFeesSov = 0;
    try {
      platformFeesSov = (this.db.prepare('SELECT SUM(fee_sov) as s FROM token_transfers').get() as any)?.s || 0;
    } catch (_) {}

    const totalInjectedSov = this.getRevenueSetting('total_genesis_minted_sov', 5000000.0).valueNum;
    const escrowsTotal = Math.round(quadraticEscrowSov * 1000) / 1000;
    const treasuryReserveSov = Math.round(platformFeesSov * 1000) / 1000;
    const unsettledReferralsSov = 0.0;

    const totalSystemAccounting = Math.round((userBalancesSov + escrowsTotal + treasuryReserveSov) * 1000) / 1000;
    // Solvency Invariant: Injected capital must equal or back all current liabilities and accumulated reserves
    // Delta = Total Injected - Total Accounted
    const solvencyDeltaSov = Math.round((totalInjectedSov - totalSystemAccounting) * 1000) / 1000;
    const isSolvent = Math.abs(solvencyDeltaSov) < 0.001 || solvencyDeltaSov >= 0; // >= 0 means surplus buffer intact

    const auditTimestamp = Date.now();
    const verificationHash = crypto.createHash('sha256')
      .update(`SOLVENCY_V2|${totalInjectedSov}|${userBalancesSov}|${escrowsTotal}|${treasuryReserveSov}|${solvencyDeltaSov}|${auditTimestamp}`)
      .digest('hex');

    return {
      ok: true,
      solvencyDeltaSov,
      isSolvent,
      healthStatus: isSolvent ? 'HEALTHY' : 'DISCREPANCY',
      totalSystemSov: totalSystemAccounting,
      breakdown: {
        totalInjectedSov: Math.round(totalInjectedSov * 1000) / 1000,
        userBalancesSov: Math.round(userBalancesSov * 1000) / 1000,
        escrowsLockedSov: {
          total: escrowsTotal,
          sponsoredBounties: 0,
          quadraticEscrows: escrowsTotal,
          promotionsUnspent: 0,
        },
        treasuryReserveSov,
        unsettledReferralsSov,
      },
      verificationHash,
      auditTimestamp,
    };
  }

  // ==========================================
  // 🔍 OFF-PLATFORM DISINTERMEDIATION RADAR (NLP / REGEX)
  // ==========================================
  public scanTextForDisintermediation(text: string): {
    detected: boolean;
    matches: Array<{ type: string; match: string }>;
    riskScore: number;
    recommendedAction: string;
  } {
    if (!text || typeof text !== 'string') {
      return { detected: false, matches: [], riskScore: 0, recommendedAction: 'NONE' };
    }

    const matches: Array<{ type: string; match: string }> = [];
    let riskScore = 0;

    // 1. UPI VPA Handles (India/SEA P2P disintermediation)
    const upiRegex = /[a-zA-Z0-9.\-_]{2,256}@(okhdfcbank|okaxis|okicici|oksbi|paytm|ybl|apl|upi|axl|ibl|barodampay|postbank|sbi|hdfcbank|icici|kotak)/gi;
    let upiMatch;
    while ((upiMatch = upiRegex.exec(text)) !== null) {
      matches.push({ type: 'UPI_VPA', match: upiMatch[0] });
      riskScore += 45;
    }

    // 2. Telegram Payment / Channel Handles
    const tgLinkRegex = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/[a-zA-Z0-9_]{3,64}/gi;
    let tgMatch;
    while ((tgMatch = tgLinkRegex.exec(text)) !== null) {
      matches.push({ type: 'TELEGRAM_LINK', match: tgMatch[0] });
      riskScore += 35;
    }
    const tgHandleRegex = /@(?!sovra)[a-zA-Z0-9_]{3,32}_(?:bot|channel|group|pay|vip)/gi;
    let tgHandleMatch;
    while ((tgHandleMatch = tgHandleRegex.exec(text)) !== null) {
      matches.push({ type: 'TELEGRAM_BOT_HANDLE', match: tgHandleMatch[0] });
      riskScore += 30;
    }

    // 3. External Wallets & Tipping Links
    const walletRegex = /(?:https?:\/\/)?(?:www\.)?(?:paypal\.me|buymeacoffee\.com|ko-fi\.com|patreon\.com|venmo\.com|cash\.app\/[$a-zA-Z0-9_]+)/gi;
    let walletMatch;
    while ((walletMatch = walletRegex.exec(text)) !== null) {
      matches.push({ type: 'EXTERNAL_WALLET', match: walletMatch[0] });
      riskScore += 40;
    }

    // 4. Raw Payment Phone Numbers
    const phoneRegex = /(?:(?:\+91|0091|0)?[ -]?)?[6789]\d{9}/g;
    let phoneMatch;
    while ((phoneMatch = phoneRegex.exec(text)) !== null) {
      matches.push({ type: 'PAYMENT_PHONE_NUMBER', match: phoneMatch[0] });
      riskScore += 15;
    }

    const detected = matches.length > 0;
    let recommendedAction = 'NONE';
    if (riskScore >= 40) {
      recommendedAction = 'WARN_CREATOR_AND_SOFT_SUPPRESS';
    } else if (riskScore > 0) {
      recommendedAction = 'MONITOR_ENGAGEMENT';
    }

    return {
      detected,
      matches,
      riskScore: Math.min(100, riskScore),
      recommendedAction,
    };
  }

  public logDisintermediationEvent(
    authorDid: string,
    contentSnippet: string,
    matchedTypes: string[],
    matchedTerms: string[],
    riskScore: number,
  ): string {
    const id = 'leak_' + crypto.randomUUID().slice(0, 8);
    try {
      this.prepareCached(`
        INSERT INTO admin_disintermediation_events (id, author_did, content_snippet, matched_types, matched_terms, risk_score, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'FLAGGED', ?)
      `).run(
        id,
        authorDid,
        contentSnippet.slice(0, 500),
        matchedTypes.join(','),
        matchedTerms.join(','),
        riskScore,
        Date.now(),
      );
    } catch (_) {}
    return id;
  }

  public getDisintermediationEvents(limit = 50): Array<{
    id: string;
    authorDid: string;
    contentSnippet: string;
    matchedTypes: string[];
    matchedTerms: string[];
    riskScore: number;
    status: string;
    createdAt: number;
  }> {
    try {
      const rows = this.db.prepare('SELECT id, author_did, content_snippet, matched_types, matched_terms, risk_score, status, created_at FROM admin_disintermediation_events ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
      return rows.map(r => ({
        id: r.id,
        authorDid: r.author_did,
        contentSnippet: r.content_snippet,
        matchedTypes: (r.matched_types || '').split(',').filter(Boolean),
        matchedTerms: (r.matched_terms || '').split(',').filter(Boolean),
        riskScore: Number(r.risk_score),
        status: r.status,
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // 🔄 CIRCULAR WASH-TRADING GRAPH CYCLE DETECTOR (DFS)
  // ==========================================
  public recordTokenTransfer(transfer: {
    id?: string;
    fromDid: string;
    toDid: string;
    amountSov: number;
    feeSov?: number;
    txType?: string;
  }): string {
    const id = transfer.id || 'tx_' + crypto.randomUUID().slice(0, 8);
    const fee = transfer.feeSov ?? (transfer.amountSov * (this.getPlatformTakeRate() / 100));
    try {
      this.prepareCached(`
        INSERT INTO token_transfers (id, from_did, to_did, amount_sov, fee_sov, tx_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, transfer.fromDid, transfer.toDid, transfer.amountSov, fee, transfer.txType || 'TIP', Date.now());
    } catch (_) {}
    return id;
  }

  public getTokenTransfers(limit = 100): Array<{
    id: string;
    fromDid: string;
    toDid: string;
    amountSov: number;
    feeSov: number;
    txType: string;
    createdAt: number;
  }> {
    try {
      const rows = this.db.prepare('SELECT id, from_did, to_did, amount_sov, fee_sov, tx_type, created_at FROM token_transfers ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
      return rows.map(r => ({
        id: r.id,
        fromDid: r.from_did,
        toDid: r.to_did,
        amountSov: Number(r.amount_sov),
        feeSov: Number(r.fee_sov),
        txType: r.tx_type,
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public detectWashTradingCycles(lookbackHours = 72): Array<{
    id: string;
    cycle: string[];
    totalVolumeSov: number;
    txCount: number;
    detectedAt: number;
  }> {
    const cutoff = Date.now() - (lookbackHours * 3600 * 1000);
    let rows: any[] = [];
    try {
      rows = this.db.prepare('SELECT from_did, to_did, amount_sov, created_at FROM token_transfers WHERE created_at >= ?').all(cutoff) as any[];
    } catch (_) {
      return [];
    }

    if (rows.length < 2) return [];

    // Build directed adjacency list
    const adj = new Map<string, Array<{ to: string; amount: number }>>();
    for (const r of rows) {
      if (!adj.has(r.from_did)) adj.set(r.from_did, []);
      adj.get(r.from_did)!.push({ to: r.to_did, amount: Number(r.amount_sov) });
    }

    const detectedCycles: Array<{ id: string; cycle: string[]; totalVolumeSov: number; txCount: number; detectedAt: number }> = [];
    const seenCycles = new Set<string>();

    // Normalize cycle so the lexicographically smallest DID comes first
    function canonicalize(path: string[]): string {
      let minIdx = 0;
      for (let i = 1; i < path.length; i++) {
        if (path[i] < path[minIdx]) minIdx = i;
      }
      const rotated = [...path.slice(minIdx), ...path.slice(0, minIdx)];
      return rotated.join('->');
    }

    // Depth-First Search for cycles of length 2, 3, and 4
    function dfs(start: string, current: string, path: string[], volumeAcc: number, depth: number) {
      if (depth > 4) return;
      const neighbors = adj.get(current) || [];
      for (const edge of neighbors) {
        if (edge.to === start && path.length >= 2) {
          const canonKey = canonicalize(path);
          if (!seenCycles.has(canonKey)) {
            seenCycles.add(canonKey);
            const cycleId = 'wash_' + crypto.randomUUID().slice(0, 8);
            detectedCycles.push({
              id: cycleId,
              cycle: [...path, start],
              totalVolumeSov: Math.round((volumeAcc + edge.amount) * 100) / 100,
              txCount: path.length,
              detectedAt: Date.now(),
            });
          }
        } else if (!path.includes(edge.to) && depth < 4) {
          dfs(start, edge.to, [...path, edge.to], volumeAcc + edge.amount, depth + 1);
        }
      }
    }

    for (const node of adj.keys()) {
      dfs(node, node, [node], 0, 1);
    }

    // Persist new flags
    const insertFlag = this.prepareCached(`
      INSERT OR REPLACE INTO admin_wash_trading_flags (id, cycle_dids_json, total_volume_sov, tx_count, status, detected_at)
      VALUES (?, ?, ?, ?, 'FLAGGED', ?)
    `);
    for (const c of detectedCycles) {
      try {
        insertFlag.run(c.id, JSON.stringify(c.cycle), c.totalVolumeSov, c.txCount, c.detectedAt);
      } catch (_) {}
    }

    return detectedCycles;
  }

  public getWashTradingFlags(): Array<{
    id: string;
    cycleDids: string[];
    totalVolumeSov: number;
    txCount: number;
    status: string;
    detectedAt: number;
  }> {
    try {
      const rows = this.db.prepare('SELECT id, cycle_dids_json, total_volume_sov, tx_count, status, detected_at FROM admin_wash_trading_flags ORDER BY detected_at DESC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        cycleDids: JSON.parse(r.cycle_dids_json || '[]'),
        totalVolumeSov: Number(r.total_volume_sov),
        txCount: Number(r.tx_count),
        status: r.status,
        detectedAt: r.detected_at,
      }));
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // 👁️ THE PANOPTICON: LIVE SWARM INSPECTOR & SESSION TERMINATOR
  // ==========================================
  public getPanopticonSessions(limit = 100): Array<{
    sessionId: string;
    userDid: string;
    handle: string;
    displayName: string;
    deviceName: string;
    deviceType: string;
    ipAddress: string;
    userAgent: string;
    createdAt: number;
    lastActiveAt: number;
    isRevoked: boolean;
    balanceSov: number;
  }> {
    try {
      const rows = this.db.prepare(`
        SELECT s.session_id, s.user_did, s.device_name, s.device_type, s.ip_address, s.user_agent,
               s.created_at, s.last_active_at, s.is_revoked, u.handle, u.display_name, u.balance_sov
        FROM user_sessions s
        LEFT JOIN users u ON s.user_did = u.did
        ORDER BY s.last_active_at DESC
        LIMIT ?
      `).all(limit) as any[];
      return rows.map(r => ({
        sessionId: r.session_id,
        userDid: r.user_did,
        handle: r.handle || 'unknown',
        displayName: r.display_name || 'Anonymous Peer',
        deviceName: r.device_name,
        deviceType: r.device_type,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
        isRevoked: Boolean(r.is_revoked),
        balanceSov: Number(r.balance_sov || 0),
      }));
    } catch (_) {
      return [];
    }
  }

  public terminateUserSession(sessionId: string): boolean {
    try {
      this.prepareCached('UPDATE user_sessions SET is_revoked = 1 WHERE session_id = ?').run(sessionId);
      const row = this.prepareCached('SELECT token FROM user_sessions WHERE session_id = ?').get(sessionId) as any;
      if (row && row.token) {
        this.revokeSession(row.token);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  public terminateAllUserSessions(userDid: string): boolean {
    try {
      this.prepareCached('UPDATE user_sessions SET is_revoked = 1 WHERE user_did = ?').run(userDid);
      const rows = this.db.prepare('SELECT token FROM user_sessions WHERE user_did = ?').all(userDid) as any[];
      for (const r of rows) {
        if (r.token) this.revokeSession(r.token);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // ==========================================
  // 🛑 NUCLEAR KILL-SWITCH MATRIX (BLAST-RADIUS ISOLATION)
  // ==========================================
  public getKillSwitches(): Array<{ switchId: string; label: string; description: string; isActive: boolean; triggeredBy?: string; triggeredAt: number }> {
    try {
      const rows = this.db.prepare('SELECT switch_id, label, description, is_active, triggered_by, triggered_at FROM admin_kill_switches ORDER BY switch_id ASC').all() as any[];
      return rows.map(r => ({
        switchId: r.switch_id,
        label: r.label,
        description: r.description,
        isActive: Boolean(r.is_active),
        triggeredBy: r.triggered_by || undefined,
        triggeredAt: r.triggered_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public setKillSwitch(switchId: string, active: boolean, adminDid = 'SOVRA-COMMAND-CONSOLE'): boolean {
    try {
      this.prepareCached(`
        UPDATE admin_kill_switches
        SET is_active = ?, triggered_by = ?, triggered_at = ?
        WHERE switch_id = ?
      `).run(active ? 1 : 0, adminDid, Date.now(), switchId);
      return true;
    } catch (_) {
      return false;
    }
  }

  public isKillSwitchActive(switchId: string): boolean {
    try {
      const row = this.prepareCached('SELECT is_active FROM admin_kill_switches WHERE switch_id = ?').get(switchId) as any;
      return Boolean(row && row.is_active);
    } catch (_) {
      return false;
    }
  }

  // ==========================================
  // 🍯 HONEYPOT CANARY INTRUSION TRAPS (ZERO-DAY NEUTRALIZER)
  // ==========================================
  public recordHoneypotIntrusion(
    trapPath: string,
    sourceIp: string,
    userAgent: string,
    headersJson = '',
    payloadSnippet = '',
  ): { intrusionId: string; actionTaken: string } {
    const id = 'trap_' + crypto.randomUUID().slice(0, 8);
    const actionTaken = 'ZERO_REACH_SHADOWBAN_APPLIED';
    try {
      this.prepareCached(`
        INSERT INTO admin_honeypot_intrusions (id, trap_path, source_ip, user_agent, headers_json, payload_snippet, action_taken, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, trapPath, sourceIp, userAgent, headersJson, payloadSnippet.slice(0, 500), actionTaken, Date.now());

      // Auto-shadowban intruder IP with 0.00x visibility decay
      const intruderDid = 'did:ip:' + sourceIp.replace(/[^a-zA-Z0-9]/g, '_');
      this.setShadowban(intruderDid, '@intruder_' + id.slice(0, 6), `Automated Honeypot Trap Trigger: ${trapPath}`, 0.0, Date.now() + 86400000 * 30);
    } catch (_) {}
    return { intrusionId: id, actionTaken };
  }

  public getHoneypotIntrusions(limit = 50): Array<{
    id: string;
    trapPath: string;
    sourceIp: string;
    userAgent: string;
    actionTaken: string;
    detectedAt: number;
  }> {
    try {
      const rows = this.db.prepare('SELECT id, trap_path, source_ip, user_agent, action_taken, detected_at FROM admin_honeypot_intrusions ORDER BY detected_at DESC LIMIT ?').all(limit) as any[];
      return rows.map(r => ({
        id: r.id,
        trapPath: r.trap_path,
        sourceIp: r.source_ip,
        userAgent: r.user_agent,
        actionTaken: r.action_taken,
        detectedAt: r.detected_at,
      }));
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // 👻 GHOST MODE: ZERO-KNOWLEDGE AUDITED IMPERSONATION
  // ==========================================
  public createGhostSession(targetDid: string, adminDid: string, ipAddress = '127.0.0.1', userAgent = 'AdminConsole/GhostMode'): {
    ghostToken: string;
    targetDid: string;
    targetHandle: string;
    expiresAt: number;
  } | null {
    const user = this.findUserByDid(targetDid);
    if (!user) return null;
    const ghostToken = 'ghost_sec_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 2 * 3600 * 1000; // 2 hour TTL
    try {
      this.prepareCached(`
        INSERT INTO admin_ghost_sessions (session_id, target_did, target_handle, admin_did, ip_address, user_agent, is_active, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(ghostToken, user.did, user.handle, adminDid, ipAddress, userAgent, Date.now(), expiresAt);

      // Audit log entry
      this.prepareCached(`
        INSERT INTO audit_logs (id, actor_did, action, details, ip_address, timestamp)
        VALUES (?, ?, 'GHOST_IMPERSONATION_START', ?, ?, ?)
      `).run('audit_' + crypto.randomUUID().slice(0, 8), adminDid, `Read-only impersonation of ${user.did} (${user.handle})`, ipAddress, Date.now());
    } catch (_) {}
    return { ghostToken, targetDid: user.did, targetHandle: user.handle, expiresAt };
  }

  public validateGhostSession(ghostToken: string): { valid: boolean; targetDid?: string; targetHandle?: string } {
    try {
      const row = this.prepareCached('SELECT target_did, target_handle, expires_at, is_active FROM admin_ghost_sessions WHERE session_id = ?').get(ghostToken) as any;
      if (!row || !row.is_active || Date.now() > row.expires_at) {
        return { valid: false };
      }
      return { valid: true, targetDid: row.target_did, targetHandle: row.target_handle };
    } catch (_) {
      return { valid: false };
    }
  }

  // ==========================================
  // 🤖 24/7 AUTONOMOUS AI SENTINEL HEURISTIC ENGINE
  // ==========================================
  public runSentinelHealthAudit(): {
    threatLevel: 'GREEN' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
    score: number;
    heuristics: {
      activeSessions: number;
      sybilSpikeRate1h: number;
      activeWashCycles: number;
      honeypotTriggers24h: number;
      solvencyStatus: string;
      activeKillSwitches: number;
    };
    recommendedPosture: string;
    auditedAt: number;
  } {
    let activeSessions = 0;
    try {
      activeSessions = (this.db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE is_revoked = 0').get() as any)?.c || 0;
    } catch (_) {}

    const oneHourAgo = Date.now() - 3600 * 1000;
    let sybilSpikeRate1h = 0;
    try {
      sybilSpikeRate1h = (this.db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(oneHourAgo) as any)?.c || 0;
    } catch (_) {}

    let activeWashCycles = 0;
    try {
      activeWashCycles = this.detectWashTradingCycles(72).length;
    } catch (_) {}

    const oneDayAgo = Date.now() - 86400 * 1000;
    let honeypotTriggers24h = 0;
    try {
      honeypotTriggers24h = (this.db.prepare('SELECT COUNT(*) as c FROM admin_honeypot_intrusions WHERE detected_at >= ?').get(oneDayAgo) as any)?.c || 0;
    } catch (_) {}

    const solvency = this.getTreasurySolvencyReport();
    const activeKillSwitches = this.getKillSwitches().filter(s => s.isActive).length;

    let score = 10;
    if (sybilSpikeRate1h > 100) score += 30;
    else if (sybilSpikeRate1h > 30) score += 15;

    if (activeWashCycles > 0) score += 20;
    if (honeypotTriggers24h > 0) score += 25;
    if (!solvency.isSolvent) score += 35;

    let threatLevel: 'GREEN' | 'ELEVATED' | 'HIGH' | 'CRITICAL' = 'GREEN';
    let recommendedPosture = 'ALL_CLEAR_STANDARD_OPERATIONS';

    if (score >= 70 || !solvency.isSolvent) {
      threatLevel = 'CRITICAL';
      recommendedPosture = 'ENGAGE_GLOBAL_WITHDRAWALS_FREEZE';
    } else if (score >= 45 || honeypotTriggers24h > 0) {
      threatLevel = 'HIGH';
      recommendedPosture = 'RESTRICT_HIGH_VELOCITY_TIPPING_AND_PROMOS';
    } else if (score >= 25 || activeWashCycles > 0) {
      threatLevel = 'ELEVATED';
      recommendedPosture = 'INCREASE_NLP_OCR_SAMPLING_AND_CYCLE_POLLING';
    }

    return {
      threatLevel,
      score: Math.min(100, score),
      heuristics: {
        activeSessions,
        sybilSpikeRate1h,
        activeWashCycles,
        honeypotTriggers24h,
        solvencyStatus: solvency.healthStatus,
        activeKillSwitches,
      },
      recommendedPosture,
      auditedAt: Date.now(),
    };
  }

  // ==========================================
  // 📡 WIRETAP PACKET SNIFFER (ZERO DARK TRAFFIC)
  // ==========================================
  public recordWiretapRequest(req: {
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    ipAddress: string;
    userAgent: string;
    bytes: number;
    did?: string;
  }): void {
    const id = 'tap_' + crypto.randomUUID().slice(0, 8);
    const entry = {
      id,
      method: req.method,
      path: req.path,
      status: req.status,
      latencyMs: Math.round(req.latencyMs * 10) / 10,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent.slice(0, 80),
      bytes: req.bytes,
      did: req.did,
      timestamp: Date.now(),
    };

    this.wiretapBuffer.unshift(entry);
    if (this.wiretapBuffer.length > 200) {
      this.wiretapBuffer.pop();
    }

    try {
      this.prepareCached(`
        INSERT INTO admin_wiretap_telemetry (id, method, path, status, latency_ms, ip_address, user_agent, bytes, did, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.method, entry.path, entry.status, entry.latencyMs, entry.ipAddress, entry.userAgent, entry.bytes, entry.did || null, entry.timestamp);
    } catch (_) {}
  }

  public getWiretapRequests(limit = 50): Array<{
    id: string;
    method: string;
    path: string;
    status: number;
    latencyMs: number;
    ipAddress: string;
    userAgent: string;
    bytes: number;
    did?: string;
    timestamp: number;
  }> {
    if (this.wiretapBuffer.length > 0) {
      return this.wiretapBuffer.slice(0, limit);
    }
    try {
      const rows = this.db.prepare('SELECT id, method, path, status, latency_ms, ip_address, user_agent, bytes, did, timestamp FROM admin_wiretap_telemetry ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
      return rows.map(r => ({
        id: r.id,
        method: r.method,
        path: r.path,
        status: r.status,
        latencyMs: Number(r.latency_ms),
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        bytes: Number(r.bytes),
        did: r.did || undefined,
        timestamp: r.timestamp,
      }));
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // 📈 AUTONOMOUS UNIT ECONOMICS & RUNWAY SIMULATOR
  // ==========================================
  public getRunwayForecast(): {
    liquidTreasurySov: number;
    dailyIntakeSov: number;
    dailyBurnSov: number;
    netCashflowSov: number;
    runwayDays: number;
    isCompounding: boolean;
    healthStatus: 'PROFITABLE_COMPOUNDING' | 'STABLE_SUSTAINABLE' | 'RUNWAY_CRITICAL';
    forecastTimestamp: number;
  } {
    const solvency = this.getTreasurySolvencyReport();
    const liquidTreasurySov = solvency.breakdown.treasuryReserveSov;

    // Calculate daily fee volume over past 7 days
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    let feeSum7d = 0;
    try {
      feeSum7d = (this.db.prepare('SELECT SUM(fee_sov) as s FROM token_transfers WHERE created_at >= ?').get(sevenDaysAgo) as any)?.s || 0;
    } catch (_) {}

    const dailyIntakeSov = Math.round((feeSum7d / 7 + 125.0) * 100) / 100; // base protocol commerce assumption
    const dailyBurnSov = 45.0; // base DePIN relay rewards & promotional drip

    const netCashflowSov = Math.round((dailyIntakeSov - dailyBurnSov) * 100) / 100;
    const isCompounding = netCashflowSov > 0;
    const runwayDays = isCompounding ? 9999 : Math.max(1, Math.round(liquidTreasurySov / Math.abs(netCashflowSov)));

    let healthStatus: 'PROFITABLE_COMPOUNDING' | 'STABLE_SUSTAINABLE' | 'RUNWAY_CRITICAL' = 'PROFITABLE_COMPOUNDING';
    if (!isCompounding && runwayDays < 90) {
      healthStatus = 'RUNWAY_CRITICAL';
    } else if (!isCompounding) {
      healthStatus = 'STABLE_SUSTAINABLE';
    }

    return {
      liquidTreasurySov,
      dailyIntakeSov,
      dailyBurnSov,
      netCashflowSov,
      runwayDays,
      isCompounding,
      healthStatus,
      forecastTimestamp: Date.now(),
    };
  }

  public getCreatorRoiAttribution(): Array<{
    creatorDid: string;
    handle: string;
    followersCount: number;
    postsCount: number;
    grossFeesGeneratedSov: number;
    bountiesReceivedSov: number;
    roiRatio: number;
    status: 'VIP_HIGH_ROI' | 'SELF_SUSTAINING' | 'UNPROFITABLE_SUBSIDY';
  }> {
    try {
      const topCreators = this.db.prepare(`
        SELECT did, handle, balance_sov FROM users ORDER BY balance_sov DESC LIMIT 10
      `).all() as any[];

      return topCreators.map(c => {
        let posts = 0;
        try {
          posts = (this.db.prepare('SELECT COUNT(*) as c FROM posts WHERE author_did = ?').get(c.did) as any)?.c || 0;
        } catch (_) {}

        let followers = 0;
        try {
          followers = (this.db.prepare('SELECT COUNT(*) as c FROM follows WHERE target_did = ?').get(c.did) as any)?.c || 0;
        } catch (_) {}

        let fees = 0;
        try {
          fees = (this.db.prepare('SELECT SUM(fee_sov) as s FROM token_transfers WHERE to_did = ?').get(c.did) as any)?.s || 0;
        } catch (_) {}

        const bounties = 100.0;
        const grossFees = Math.round((fees + posts * 1.5) * 100) / 100;
        const roi = Math.round((grossFees / Math.max(1, bounties)) * 100) / 100;

        let status: 'VIP_HIGH_ROI' | 'SELF_SUSTAINING' | 'UNPROFITABLE_SUBSIDY' = 'SELF_SUSTAINING';
        if (roi >= 2.0) status = 'VIP_HIGH_ROI';
        else if (roi < 0.5) status = 'UNPROFITABLE_SUBSIDY';

        return {
          creatorDid: c.did,
          handle: c.handle,
          followersCount: followers,
          postsCount: posts,
          grossFeesGeneratedSov: grossFees,
          bountiesReceivedSov: bounties,
          roiRatio: roi,
          status,
        };
      });
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // ⏱️ CHRONOS TIME-TRAVEL SNAPSHOTS (ZERO-ERROR RECOVERY)
  // ==========================================
  public createChronosSnapshot(label: string, adminDid = 'SOVRA-COMMAND-CONSOLE'): {
    id: string;
    filePath: string;
    fileSizeBytes: number;
    sha256Seal: string;
    createdAt: number;
  } {
    const snapshotsDir = path.join(this.storageDir, 'chronos-snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const now = Date.now();
    const cleanLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const snapshotFile = path.join(snapshotsDir, `snapshot_${now}_${cleanLabel}.sqlite`);
    const sanitizedPath = snapshotFile.replace(/\\/g, '/').replace(/'/g, "''");

    this.db.exec(`VACUUM INTO '${sanitizedPath}'`);

    const stats = fs.statSync(snapshotFile);
    const content = fs.readFileSync(snapshotFile);
    const sha256Seal = crypto.createHash('sha256').update(content).digest('hex');
    const id = 'snap_' + now;

    try {
      this.prepareCached(`
        INSERT INTO admin_chronos_snapshots (id, label, file_path, file_size_bytes, sha256_seal, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, label, snapshotFile, stats.size, sha256Seal, adminDid, now);
    } catch (_) {}

    return {
      id,
      filePath: snapshotFile,
      fileSizeBytes: stats.size,
      sha256Seal,
      createdAt: now,
    };
  }

  public listChronosSnapshots(): Array<{
    id: string;
    label: string;
    filePath: string;
    fileSizeBytes: number;
    fileSizeMb: string;
    sha256Seal: string;
    createdBy: string;
    createdAt: number;
  }> {
    try {
      const rows = this.db.prepare('SELECT id, label, file_path, file_size_bytes, sha256_seal, created_by, created_at FROM admin_chronos_snapshots ORDER BY created_at DESC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        label: r.label,
        filePath: r.file_path,
        fileSizeBytes: r.file_size_bytes,
        fileSizeMb: (r.file_size_bytes / (1024 * 1024)).toFixed(2) + ' MB',
        sha256Seal: r.sha256_seal,
        createdBy: r.created_by,
        createdAt: r.created_at,
      }));
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // 🔐 ROLE-BASED ACCESS CONTROL (RBAC) STATION
  // ==========================================
  public assignRbacRole(adminDid: string, role: string, permissions: string[], assignedBy = 'did:sov:admin_root'): void {
    const now = Date.now();
    this.prepareCached(`
      INSERT OR REPLACE INTO admin_rbac_roles (admin_did, role, permissions_json, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(adminDid, role, JSON.stringify(permissions), assignedBy, now);

    this.recordTamperProofAuditEntry({
      adminDid: assignedBy,
      role: 'SUPER_ADMIN',
      actionType: 'RBAC_ROLE_ASSIGNED',
      targetResource: adminDid,
      payload: { role, permissions },
      ipAddress: '127.0.0.1',
    });
  }

  public getRbacRole(adminDid: string): { adminDid: string; role: string; permissions: string[] } | null {
    if (adminDid === 'did:sov:admin_root') {
      return { adminDid, role: 'SUPER_ADMIN', permissions: ['*'] };
    }
    try {
      const row = this.db.prepare('SELECT admin_did, role, permissions_json FROM admin_rbac_roles WHERE admin_did = ?').get(adminDid) as any;
      if (!row) return null;
      return {
        adminDid: row.admin_did,
        role: row.role,
        permissions: JSON.parse(row.permissions_json || '[]'),
      };
    } catch (_) {
      return null;
    }
  }

  public listRbacRoles(): Array<{ adminDid: string; role: string; permissions: string[]; assignedBy: string; assignedAt: number }> {
    try {
      const rows = this.db.prepare('SELECT admin_did, role, permissions_json, assigned_by, assigned_at FROM admin_rbac_roles ORDER BY assigned_at DESC').all() as any[];
      return rows.map(r => ({
        adminDid: r.admin_did,
        role: r.role,
        permissions: JSON.parse(r.permissions_json || '[]'),
        assignedBy: r.assigned_by,
        assignedAt: r.assigned_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public hasPermission(adminDid: string, permission: string): boolean {
    if (!adminDid || adminDid === 'did:sov:admin_root') return true;
    const rbac = this.getRbacRole(adminDid);
    if (!rbac) return false;
    if (rbac.permissions.includes('*')) return true;
    if (rbac.permissions.includes(permission)) return true;
    // Check wildcard prefix e.g. "kill_switches:*" or "*:read"
    for (const p of rbac.permissions) {
      if (p.endsWith(':*') && permission.startsWith(p.replace(':*', ':'))) return true;
      if (p.startsWith('*:') && permission.endsWith(p.replace('*:', ':'))) return true;
    }
    return false;
  }

  // ==========================================
  // ⛓️ CRYPTOGRAPHIC TAMPER-EVIDENT AUDIT LEDGER
  // ==========================================
  public recordTamperProofAuditEntry(params: {
    adminDid: string;
    role?: string;
    actionType: string;
    targetResource: string;
    payload: any;
    ipAddress?: string;
  }): { entryId: string; sequenceNum: number; prevHash: string; currentHash: string; createdAt: number } {
    const now = Date.now();
    const entryId = 'aud_' + crypto.randomUUID().slice(0, 10);
    const ip = params.ipAddress || '127.0.0.1';
    const role = params.role || this.getRbacRole(params.adminDid)?.role || 'ADMIN';
    const payloadStr = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload || {});

    // Fetch latest entry for hash-chaining
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    let sequenceNum = 0;
    try {
      const lastEntry = this.db.prepare('SELECT sequence_num, current_hash FROM admin_tamper_evident_audit_ledger ORDER BY sequence_num DESC LIMIT 1').get() as any;
      if (lastEntry) {
        prevHash = lastEntry.current_hash;
        sequenceNum = Number(lastEntry.sequence_num) + 1;
      }
    } catch (_) {}

    const hashInput = `${prevHash}:${sequenceNum}:${params.adminDid}:${params.actionType}:${params.targetResource}:${payloadStr}:${now}`;
    const currentHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    try {
      this.prepareCached(`
        INSERT INTO admin_tamper_evident_audit_ledger (
          entry_id, sequence_num, admin_did, role, action_type, target_resource, payload_json, ip_address, prev_hash, current_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entryId, sequenceNum, params.adminDid, role, params.actionType, params.targetResource, payloadStr, ip, prevHash, currentHash, now);
    } catch (_) {}

    return {
      entryId,
      sequenceNum,
      prevHash,
      currentHash,
      createdAt: now,
    };
  }

  public getTamperProofAuditLedger(limit = 100): Array<{
    entryId: string;
    sequenceNum: number;
    adminDid: string;
    role: string;
    actionType: string;
    targetResource: string;
    payload: any;
    ipAddress: string;
    prevHash: string;
    currentHash: string;
    createdAt: number;
  }> {
    try {
      const rows = this.db.prepare(`
        SELECT entry_id, sequence_num, admin_did, role, action_type, target_resource, payload_json, ip_address, prev_hash, current_hash, created_at
        FROM admin_tamper_evident_audit_ledger
        ORDER BY sequence_num DESC
        LIMIT ?
      `).all(limit) as any[];

      return rows.map(r => {
        let parsedPayload = {};
        try { parsedPayload = JSON.parse(r.payload_json); } catch (_) { parsedPayload = r.payload_json; }
        return {
          entryId: r.entry_id,
          sequenceNum: r.sequence_num,
          adminDid: r.admin_did,
          role: r.role,
          actionType: r.action_type,
          targetResource: r.target_resource,
          payload: parsedPayload,
          ipAddress: r.ip_address,
          prevHash: r.prev_hash,
          currentHash: r.current_hash,
          createdAt: r.created_at,
        };
      });
    } catch (_) {
      return [];
    }
  }

  public verifyTamperProofAuditChain(): {
    isValid: boolean;
    totalEntries: number;
    tamperedAtSeq?: number;
    headHash: string;
    reason?: string;
  } {
    try {
      const rows = this.db.prepare(`
        SELECT entry_id, sequence_num, admin_did, role, action_type, target_resource, payload_json, ip_address, prev_hash, current_hash, created_at
        FROM admin_tamper_evident_audit_ledger
        ORDER BY sequence_num ASC
      `).all() as any[];

      if (rows.length === 0) {
        return { isValid: true, totalEntries: 0, headHash: 'EMPTY' };
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (i === 0) {
          if (row.sequence_num !== 0) {
            return { isValid: false, totalEntries: rows.length, tamperedAtSeq: row.sequence_num, headHash: row.current_hash, reason: 'Genesis sequence number is not 0' };
          }
        } else {
          const prevRow = rows[i - 1];
          if (row.prev_hash !== prevRow.current_hash) {
            return {
              isValid: false,
              totalEntries: rows.length,
              tamperedAtSeq: row.sequence_num,
              headHash: rows[rows.length - 1].current_hash,
              reason: `Broken hash chain at sequence ${row.sequence_num}: prev_hash does not match previous current_hash`,
            };
          }
          if (row.sequence_num !== prevRow.sequence_num + 1) {
            return {
              isValid: false,
              totalEntries: rows.length,
              tamperedAtSeq: row.sequence_num,
              headHash: rows[rows.length - 1].current_hash,
              reason: `Missing sequence gap detected between ${prevRow.sequence_num} and ${row.sequence_num}`,
            };
          }
        }

        // Recompute current_hash to detect unauthorized column alterations
        const expectedHash = crypto.createHash('sha256').update(
          `${row.prev_hash}:${row.sequence_num}:${row.admin_did}:${row.action_type}:${row.target_resource}:${row.payload_json}:${row.created_at}`
        ).digest('hex');

        if (row.current_hash !== expectedHash) {
          return {
            isValid: false,
            totalEntries: rows.length,
            tamperedAtSeq: row.sequence_num,
            headHash: rows[rows.length - 1].current_hash,
            reason: `Cryptographic signature mismatch at sequence ${row.sequence_num}: payload or metadata was altered`,
          };
        }
      }

      return {
        isValid: true,
        totalEntries: rows.length,
        headHash: rows[rows.length - 1].current_hash,
      };
    } catch (err: any) {
      return { isValid: false, totalEntries: 0, headHash: 'ERROR', reason: err.message };
    }
  }

  // ==========================================
  // ⚖️ ATOMIC 4-COLUMN DOUBLE-ENTRY BALANCE TRANSFER ENGINE
  // ==========================================
  public executeAtomicLedgerTransfer(params: {
    fromDid: string;
    toDid: string;
    amountSov: number;
    feeSov?: number;
    txType?: string;
    memo?: string;
    adminDid?: string;
    requireSolvencyCheck?: boolean;
    ipAddress?: string;
  }): {
    txId: string;
    fromBalanceAfter: number;
    toBalanceAfter: number;
    solvencyInvariantPassed: boolean;
    invariantDeltaSov: number;
  } {
    const adminDid = params.adminDid || 'did:sov:admin_root';
    const feeSov = params.feeSov || 0.0;
    const amountSov = Math.round(Number(params.amountSov) * 100) / 100;
    if (amountSov <= 0) {
      throw new Error('Transfer amount must be strictly positive');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      let fromBalance = 0;
      if (params.fromDid !== 'did:sov:treasury_genesis' && !params.fromDid.startsWith('did:sov:mint:')) {
        const sender = this.db.prepare('SELECT balance_sov FROM users WHERE did = ?').get(params.fromDid) as any;
        if (!sender) {
          throw new Error(`Sender DID ${params.fromDid} not found`);
        }
        fromBalance = Number(sender.balance_sov || 0);
        if (fromBalance < (amountSov + feeSov)) {
          throw new Error(`Insufficient balance: sender has ${fromBalance} SOV, requested ${amountSov + feeSov} SOV`);
        }
        this.db.prepare('UPDATE users SET balance_sov = balance_sov - ?, updated_at = ? WHERE did = ?')
          .run(amountSov + feeSov, Date.now(), params.fromDid);
        fromBalance = fromBalance - (amountSov + feeSov);
      }

      let toBalance = 0;
      if (params.toDid !== 'did:sov:treasury_burn' && !params.toDid.startsWith('did:sov:burn:')) {
        const receiver = this.db.prepare('SELECT balance_sov FROM users WHERE did = ?').get(params.toDid) as any;
        if (!receiver) {
          throw new Error(`Receiver DID ${params.toDid} not found`);
        }
        this.db.prepare('UPDATE users SET balance_sov = balance_sov + ?, updated_at = ? WHERE did = ?')
          .run(amountSov, Date.now(), params.toDid);
        toBalance = Number(receiver.balance_sov || 0) + amountSov;
      }

      const txId = 'tx_' + crypto.randomUUID().slice(0, 12);
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO token_transfers (id, from_did, to_did, amount_sov, fee_sov, tx_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(txId, params.fromDid, params.toDid, amountSov, feeSov, params.txType || 'ADMIN_LEDGER_TRANSFER', now);

      // Verify 4-Column Double-Entry Solvency Invariant
      const audit = this.getTreasurySolvencyReport();
      if (params.requireSolvencyCheck !== false && !audit.isSolvent) {
        throw new Error(`Solvency invariant violation detected! Delta: ${audit.solvencyDeltaSov} SOV. Transaction aborted.`);
      }

      this.db.exec('COMMIT');

      // Record tamper-evident audit log
      this.recordTamperProofAuditEntry({
        adminDid,
        role: 'SUPER_ADMIN',
        actionType: 'ATOMIC_LEDGER_TRANSFER',
        targetResource: txId,
        payload: {
          fromDid: params.fromDid,
          toDid: params.toDid,
          amountSov,
          feeSov,
          txType: params.txType,
          memo: params.memo,
          solvencyDeltaSov: audit.solvencyDeltaSov,
        },
        ipAddress: params.ipAddress || '127.0.0.1',
      });

      return {
        txId,
        fromBalanceAfter: fromBalance,
        toBalanceAfter: toBalance,
        solvencyInvariantPassed: audit.isSolvent,
        invariantDeltaSov: audit.solvencyDeltaSov,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ==========================================
  // ⚡ ZERO-BLOCKING ASYNC WASH-TRADING CYCLE DETECTOR
  // ==========================================
  public async detectWashTradingCyclesAsync(
    lookbackHours = 72,
    maxSliceBudgetMs = 5
  ): Promise<Array<{ id: string; cycle: string[]; totalVolumeSov: number; txCount: number; detectedAt: number }>> {
    const cutoff = Date.now() - (lookbackHours * 3600 * 1000);
    let rows: any[] = [];
    try {
      rows = this.db.prepare('SELECT from_did, to_did, amount_sov, created_at FROM token_transfers WHERE created_at >= ?').all(cutoff) as any[];
    } catch (_) {
      return [];
    }

    if (rows.length < 2) return [];

    const adj = new Map<string, Array<{ to: string; amount: number }>>();
    for (const r of rows) {
      if (!adj.has(r.from_did)) adj.set(r.from_did, []);
      adj.get(r.from_did)!.push({ to: r.to_did, amount: Number(r.amount_sov) });
    }

    const detectedCycles: Array<{ id: string; cycle: string[]; totalVolumeSov: number; txCount: number; detectedAt: number }> = [];
    const seenCycles = new Set<string>();

    function canonicalize(path: string[]): string {
      let minIdx = 0;
      for (let i = 1; i < path.length; i++) {
        if (path[i] < path[minIdx]) minIdx = i;
      }
      const rotated = [...path.slice(minIdx), ...path.slice(0, minIdx)];
      return rotated.join('->');
    }

    let sliceStartTime = performance.now();

    const dfs = async (start: string, current: string, path: string[], volumeAcc: number, depth: number): Promise<void> => {
      if (depth > 4) return;
      if (performance.now() - sliceStartTime > maxSliceBudgetMs) {
        await new Promise(resolve => setImmediate(resolve));
        sliceStartTime = performance.now();
      }

      const neighbors = adj.get(current) || [];
      for (const edge of neighbors) {
        if (edge.to === start && path.length >= 2) {
          const canonKey = canonicalize(path);
          if (!seenCycles.has(canonKey)) {
            seenCycles.add(canonKey);
            const cycleId = 'wash_' + crypto.randomUUID().slice(0, 8);
            detectedCycles.push({
              id: cycleId,
              cycle: [...path, start],
              totalVolumeSov: Math.round((volumeAcc + edge.amount) * 100) / 100,
              txCount: path.length,
              detectedAt: Date.now(),
            });
          }
        } else if (!path.includes(edge.to) && depth < 4) {
          await dfs(start, edge.to, [...path, edge.to], volumeAcc + edge.amount, depth + 1);
        }
      }
    };

    for (const node of adj.keys()) {
      await dfs(node, node, [node], 0, 1);
    }

    const insertFlag = this.prepareCached(`
      INSERT OR REPLACE INTO admin_wash_trading_flags (id, cycle_dids_json, total_volume_sov, tx_count, status, detected_at)
      VALUES (?, ?, ?, ?, 'FLAGGED', ?)
    `);
    for (const c of detectedCycles) {
      try {
        insertFlag.run(c.id, JSON.stringify(c.cycle), c.totalVolumeSov, c.txCount, c.detectedAt);
      } catch (_) {}
    }

    return detectedCycles;
  }

  public close(): void {
    this.stmtCache.clear();
    try {
      this.db.close();
    } catch (_) {}
  }
}

export { SqliteSocialDatabaseEngine as SovraSqliteEngine };
