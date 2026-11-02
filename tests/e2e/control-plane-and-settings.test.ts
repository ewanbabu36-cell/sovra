import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SovraSqliteEngine } from '../../scripts/database-sqlite.ts';
import sovraDb from '../../scripts/database-engine.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('🚀 Sovra Enterprise Control Plane & Zero-Mock Settings Hardening Suite', () => {
  let sqlite: SovraSqliteEngine;
  const testStorageDir = path.join(process.cwd(), '.sovra_test_control_plane_' + Date.now());

  beforeAll(() => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    sqlite = new SovraSqliteEngine(testStorageDir);
  });

  afterAll(() => {
    sqlite.close();
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // PHASE 1: REAL USER SETTINGS & PROFILE PERSISTENCE
  // =========================================================================
  describe('Phase 1: Real User Settings & Profile Persistence in SQLite', () => {
    const testDid = 'did:key:z6Mktester_user_' + Date.now();

    it('returns default user settings for a fresh DID', () => {
      const settings = sqlite.getUserSettings(testDid);
      expect(settings).toBeDefined();
      expect(settings.did).toBe(testDid);
      expect(settings.mesh_discovery).toBe(1);
      expect(settings.allow_dms).toBe(1);
      expect(settings.push_notifications).toBe(1);
      expect(settings.video_autoplay).toBe(1);
      expect(settings.compact_density).toBe(0);
      expect(settings.storage_quota_gb).toBe(10);
      expect(settings.bandwidth_limit_mb).toBe(50);
      expect(typeof settings.updated_at).toBe('string');
    });

    it('persists toggles, sliders, and profile bio in user_settings table', () => {
      const updated = sqlite.setUserSettings(testDid, {
        display_name: 'Dr. Sovereign Node',
        bio: 'Decentralized systems researcher and core validator',
        mesh_discovery: 0,
        allow_dms: 0,
        push_notifications: 1,
        video_autoplay: 0,
        compact_density: 1,
        storage_quota_gb: 25,
        bandwidth_limit_mb: 150
      });

      expect(updated.display_name).toBe('Dr. Sovereign Node');
      expect(updated.bio).toBe('Decentralized systems researcher and core validator');
      expect(updated.mesh_discovery).toBe(0);
      expect(updated.allow_dms).toBe(0);
      expect(updated.video_autoplay).toBe(0);
      expect(updated.compact_density).toBe(1);
      expect(updated.storage_quota_gb).toBe(25);
      expect(updated.bandwidth_limit_mb).toBe(150);

      // Verify read-after-write consistency from SQLite
      const freshRead = sqlite.getUserSettings(testDid);
      expect(freshRead.display_name).toBe('Dr. Sovereign Node');
      expect(freshRead.mesh_discovery).toBe(0);
      expect(freshRead.storage_quota_gb).toBe(25);
    });

    it('updates user profile and synchronizes users and user_settings tables', () => {
      // Register user first
      sqlite.registerUser({
        did: testDid,
        handle: 'sov_dr',
        displayName: 'Old Name',
        avatar: '👤'
      });

      const result = sqlite.updateUserProfile(testDid, {
        name: 'Dr. Sovereign Node PhD',
        bio: 'Updated cryptographic researcher bio',
        avatar: '🌟'
      });

      expect(result.ok).toBe(true);
      expect(result.user.name).toBe('Dr. Sovereign Node PhD');
      expect(result.user.bio).toBe('Updated cryptographic researcher bio');
      expect(result.user.avatar).toBe('🌟');

      const userInDb = sqlite.findUserByDid(testDid);
      expect(userInDb?.name).toBe('Dr. Sovereign Node PhD');

      const settingsInDb = sqlite.getUserSettings(testDid);
      expect(settingsInDb.display_name).toBe('Dr. Sovereign Node PhD');
      expect(settingsInDb.bio).toBe('Updated cryptographic researcher bio');
    });

    it('delegates user settings methods through SovraSocialDatabaseEngine singleton', () => {
      const did = 'did:sovra:singleton_test_' + Date.now();
      const s = sovraDb.getUserSettings(did);
      expect(s).toBeDefined();
      expect(s.did).toBe(did);

      const saved = sovraDb.setUserSettings(did, { compact_density: 1, storage_quota_gb: 50 });
      expect(saved.compact_density).toBe(1);
      expect(saved.storage_quota_gb).toBe(50);
    });
  });

  // =========================================================================
  // PHASE 2: ADMIN MASTER APP REGISTRY & DAPP STORE CRUD
  // =========================================================================
  describe('Phase 2: Admin Master App Registry & DApp Store CRUD', () => {
    it('seeds platform_features with 25 native apps on database init', () => {
      const features = sqlite.getPlatformFeatures(true);
      expect(features.length).toBeGreaterThanOrEqual(25);

      const feedApp = features.find(f => f.id === 'feed');
      expect(feedApp).toBeDefined();
      expect(feedApp?.name).toBe('Feed');
      expect(feedApp?.category).toBe('social');
      expect(feedApp?.enabled).toBe(true);

      const osModeApp = features.find(f => f.id === 'desktop_launcher');
      expect(osModeApp).toBeDefined();
      expect(osModeApp?.name).toBe('OS Mode');
    });

    it('performs CRUD operations on platform_features', () => {
      const testFeatureId = 'podcast_radio_' + Date.now();

      // 1. Create
      const created = sqlite.createPlatformFeature({
        id: testFeatureId,
        name: 'Podcast Radio',
        icon: '🎙️',
        category: 'media',
        desc: 'Decentralized P2P Podcast Swarm Relay',
        enabled: 1,
        display_order: 30
      });
      expect(created.ok).toBe(true);
      expect(created.feature.id).toBe(testFeatureId);

      // 2. Read
      let features = sqlite.getPlatformFeatures(true);
      let found = features.find(f => f.id === testFeatureId);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Podcast Radio');
      expect(found?.enabled).toBe(true);

      // 3. Update (disable)
      const updated = sqlite.updatePlatformFeature(testFeatureId, {
        enabled: 0,
        desc: 'Temporarily disabled for scheduled node maintenance'
      });
      expect(updated.ok).toBe(true);

      features = sqlite.getPlatformFeatures(false);
      expect(features.find(f => f.id === testFeatureId)).toBeUndefined(); // Filtered out when includeDisabled=false

      features = sqlite.getPlatformFeatures(true);
      found = features.find(f => f.id === testFeatureId);
      expect(found?.enabled).toBe(false);
      expect(found?.desc).toBe('Temporarily disabled for scheduled node maintenance');

      // 4. Delete
      const deleted = sqlite.deletePlatformFeature(testFeatureId);
      expect(deleted.ok).toBe(true);

      features = sqlite.getPlatformFeatures(true);
      expect(features.find(f => f.id === testFeatureId)).toBeUndefined();
    });

    it('moderates Mini-DApps in DApp store (approve, feature, reject, delete)', () => {
      const rawDb = sqlite.getRawDb();
      const dappId = 'dapp_test_' + Date.now();

      // Insert test mini dapp
      rawDb.prepare(`
        INSERT INTO mini_dapps (id, name, author_did, version, bundle_cid, category, permissions_json, status, created_at)
        VALUES (?, 'Super DApp', 'did:sovra:author', '1.0.0', 'bafytest', 'utility', '[]', 'pending', ?)
      `).run(dappId, Date.now());

      // Approve
      let mod = sqlite.moderateDApp(dappId, 'approve');
      expect(mod.ok).toBe(true);
      let row = rawDb.prepare('SELECT status FROM mini_dapps WHERE id = ?').get(dappId) as any;
      expect(row.status).toBe('approved');

      // Feature
      mod = sqlite.moderateDApp(dappId, 'feature');
      expect(mod.ok).toBe(true);
      row = rawDb.prepare('SELECT status FROM mini_dapps WHERE id = ?').get(dappId) as any;
      expect(row.status).toBe('featured');

      // Reject
      mod = sqlite.moderateDApp(dappId, 'reject');
      expect(mod.ok).toBe(true);
      row = rawDb.prepare('SELECT status FROM mini_dapps WHERE id = ?').get(dappId) as any;
      expect(row.status).toBe('rejected');

      // Delete
      mod = sqlite.moderateDApp(dappId, 'delete');
      expect(mod.ok).toBe(true);
      row = rawDb.prepare('SELECT status FROM mini_dapps WHERE id = ?').get(dappId) as any;
      expect(row).toBeUndefined();
    });
  });

  // =========================================================================
  // PHASE 3: LIVE CONTROL PLANE & FEATURE FLAGS CONTRACT
  // =========================================================================
  describe('Phase 3: Client Feature Flags & Live SSE Control Plane Contract', () => {
    it('evaluates and retrieves canary feature flags from SQLite', () => {
      const flags = sqlite.getFeatureFlags();
      expect(Array.isArray(flags)).toBe(true);
      expect(flags.length).toBeGreaterThan(0);

      const clientFlags = sqlite.evaluateClientFlags('did:sovra:test_user');
      expect(typeof clientFlags).toBe('object');
      expect(clientFlags).toBeDefined();
    });

    it('persists kill switches and verifies nuclear isolation state', () => {
      const switches = sqlite.getKillSwitches();
      expect(Array.isArray(switches)).toBe(true);
      expect(switches.length).toBeGreaterThan(0);

      // Verify toggle with standard and custom switches
      const switchId = 'P2P_STREAMING_KILL_SWITCH';
      const toggled = sqlite.setKillSwitch(switchId, true, 'did:sovra:admin');
      expect(toggled).toBe(true);
      expect(sqlite.isKillSwitchActive(switchId)).toBe(true);

      // Reset back to standby
      sqlite.setKillSwitch(switchId, false, 'did:sovra:admin');
      expect(sqlite.isKillSwitchActive(switchId)).toBe(false);
    });
  });

  // =========================================================================
  // PHASE 4: REAL WEBRTC AUDIO & DYNAMIC HASHTAG AGGREGATION
  // =========================================================================
  describe('Phase 4: Real Hashtag Aggregation & Zero-Mock Templates', () => {
    it('aggregates real hashtags from posts and ranks top 5 trending tags', () => {
      const rawDb = sqlite.getRawDb();
      const now = Date.now();

      // Seed posts with real hashtags
      const insertPost = rawDb.prepare(`
        INSERT INTO posts (id, author_did, handle, author_name, author_avatar, author_avatar_bg, caption, created_at, updated_at)
        VALUES (?, 'did:sovra:system', 'system', 'System', '👤', '#6366f1', ?, ?, ?)
      `);

      insertPost.run('post_tag_1', 'Exploring the future of #DecentralizedTech and #Sovra4K', now, now);
      insertPost.run('post_tag_2', 'Zero knowledge proofs and #Sovra4K are amazing!', now, now);
      insertPost.run('post_tag_3', 'Building local mesh networks with #DePINMesh and #Sovra4K', now, now);

      const trending = sqlite.getTopTrendingHashtags(5);
      expect(Array.isArray(trending)).toBe(true);
      expect(trending.length).toBe(5);

      // #Sovra4K was mentioned 3 times, so it must be top
      const sovraTag = trending.find(t => t.tag.toLowerCase() === '#sovra4k');
      expect(sovraTag).toBeDefined();
      expect(sovraTag!.count).toBeGreaterThanOrEqual(3);

      const depinTag = trending.find(t => t.tag.toLowerCase() === '#depinmesh');
      expect(depinTag).toBeDefined();
    });

    it('purges fake alert() calls from dev-server client UI source code', () => {
      const devServerSrc = fs.readFileSync(path.join(process.cwd(), 'scripts', 'dev-server.ts'), 'utf8');

      // The old fake alerts in settings-view must NOT exist
      expect(devServerSrc.includes("alert('Profile changes saved successfully!')")).toBe(false);
      expect(devServerSrc.includes("alert('Backup Seed phrase copied to clipboard in secure mode.')")).toBe(false);
      expect(devServerSrc.includes("alert('Local node cache successfully cleared.')")).toBe(false);
      expect(devServerSrc.includes("SOVRA_VOICE_NOTE_MOCK_PAYLOAD")).toBe(false);

      // Real functions and components must exist
      expect(devServerSrc.includes('saveUserProfileSettings')).toBe(true);
      expect(devServerSrc.includes('loadUserSettingsIntoForm')).toBe(true);
      expect(devServerSrc.includes('openSovereignBackupModal')).toBe(true);
      expect(devServerSrc.includes('purgeLocalNodeCache')).toBe(true);
      expect(devServerSrc.includes('sovraBroadcastAlertBanner')).toBe(true);
      expect(devServerSrc.includes('initControlPlaneSse')).toBe(true);
      expect(devServerSrc.includes('/api/events/control-plane')).toBe(true);
      expect(devServerSrc.includes('/api/user/settings')).toBe(true);
      expect(devServerSrc.includes('/api/profile/update')).toBe(true);
      expect(devServerSrc.includes('/api/features')).toBe(true);
      expect(devServerSrc.includes('/api/trending/tags')).toBe(true);
    });

    it('verifies admin-console.ts includes App & DApp Directory Station with full CRUD UI', () => {
      const adminConsoleSrc = fs.readFileSync(path.join(process.cwd(), 'scripts', 'admin-console.ts'), 'utf8');

      expect(adminConsoleSrc.includes('App &amp; DApp Directory')).toBe(true);
      expect(adminConsoleSrc.includes('id="view-apps-directory"')).toBe(true);
      expect(adminConsoleSrc.includes('toggleFeatureTile')).toBe(true);
      expect(adminConsoleSrc.includes('deleteFeatureTile')).toBe(true);
      expect(adminConsoleSrc.includes('createNewPlatformFeature')).toBe(true);
      expect(adminConsoleSrc.includes('moderateDAppAction')).toBe(true);
    });
  });
});
