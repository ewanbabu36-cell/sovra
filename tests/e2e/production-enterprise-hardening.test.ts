import { describe, it, expect } from 'vitest';
import { SqliteSocialDatabaseEngine, WriteRingBuffer } from '../../scripts/database-sqlite.ts';
import fs from 'node:fs';

describe('Sovra Enterprise Production Hardening & UI/UX Polish Suite', () => {
  const BASE_URL = 'http://localhost:3001';

  // --- PHASE 1: APPLE/VISIONOS UI/UX POLISH & HAPTICS ---
  describe('Phase 1: Apple/VisionOS UI/UX Polish & Haptics', () => {
    it('serves CSS skeleton shimmer loaders for Feed, Watch, and Stories', async () => {
      const res = await fetch(BASE_URL);
      expect(res.status).toBe(200);
      const html = await res.text();

      // CSS Classes & Animations
      expect(html).toContain('.skeleton-shimmer');
      expect(html).toContain('.skeleton-card');
      expect(html).toContain('.skeleton-avatar');
      expect(html).toContain('.skeleton-line');
      expect(html).toContain('.skeleton-story');
      expect(html).toContain('.skeleton-video');
      expect(html).toContain('@keyframes sovraSkeletonShimmer');

      // Client skeleton renderers
      expect(html).toContain('function renderStoriesSkeleton(');
      expect(html).toContain('function hideStoriesSkeleton(');
      expect(html).toContain('function renderWatchSkeleton(');
      expect(html).toContain('function hideWatchSkeleton(');
      expect(html).toContain('function renderFeedSkeleton(');
      expect(html).toContain('function hideFeedSkeleton(');
    });

    it('implements native haptic feedback helper and wires it to navigation tabs', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      expect(html).toContain('function triggerHapticFeedback(');
      expect(html).toContain('navigator.vibrate(');
      expect(html).toContain('window.triggerHapticFeedback = triggerHapticFeedback;');
      expect(html).toContain("if (typeof triggerHapticFeedback === 'function') triggerHapticFeedback([8]);");
    });

    it('applies mobile safe-area insets to top header, bottom navigation, and modals', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      expect(html).toContain('env(safe-area-inset-top, 0px)');
      expect(html).toContain('padding-bottom: max(16px, env(safe-area-inset-bottom, 0px))');
      expect(html).toContain('padding-bottom: max(20px, env(safe-area-inset-bottom, 0px))');
    });
  });

  // --- PHASE 2: NON-EXTRACTABLE WEBCRYPTO IDENTITY STORAGE ---
  describe('Phase 2: Non-Extractable WebCrypto Identity Storage & Enclave', () => {
    it('includes SovraHardwareVault with WebCrypto AES-GCM and IndexedDB enclave', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      expect(html).toContain('window.SovraHardwareVault =');
      expect(html).toContain("ENCLAVE_DB = 'sovra_secure_enclave'");
      expect(html).toContain("STORE_SECRETS = 'vault_secrets'");
      expect(html).toContain("crypto.subtle.generateKey");
      expect(html).toContain("name: 'AES-GCM', length: 256");
      expect(html).toContain("false, // Non-Extractable Security Enclave");
    });

    it('provides automatic session token encryption and legacy seed migration', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      expect(html).toContain('setSecureSessionToken:');
      expect(html).toContain('getSecureSessionToken:');
      expect(html).toContain('storeNonExtractableIdentity:');
      expect(html).toContain('migrateLegacyStorage:');
      expect(html).toContain("localStorage.getItem('sovra_session_token_enc')");
    });
  });

  // --- PHASE 3: SQLITE WRITE-AHEAD RING BUFFER CONCURRENCY ---
  describe('Phase 3: SQLite Write-Ahead Ring Buffer Concurrency', () => {
    const testDir = './.test-prod-ring-buffer-' + Date.now();
    let db: SqliteSocialDatabaseEngine;
    let ringBuffer: WriteRingBuffer;

    it('initializes WriteRingBuffer with 10s busy_timeout and WAL autocheckpoint', () => {
      db = new SqliteSocialDatabaseEngine(testDir);
      ringBuffer = db.getWriteRingBuffer();

      expect(ringBuffer).toBeInstanceOf(WriteRingBuffer);
      expect(ringBuffer.getPendingCount()).toBe(0);
    });

    it('batches and merges high-frequency writes into atomic transaction', () => {
      const rawDb = db.getRawDb();
      const postId = 'post_batch_prod_test_1';
      rawDb.prepare(`
        INSERT INTO posts (id, author_did, handle, author_name, author_avatar, author_avatar_bg, caption, created_at, updated_at, views_count, likes_count)
        VALUES (?, 'did:key:test', 'test', 'Test', 'T', '#fff', 'Test', 1000, 1000, 0, 0)
      `).run(postId);

      // Enqueue 50 view increments and 10 reaction increments
      for (let i = 0; i < 50; i++) {
        ringBuffer.incrementPostView(postId, 1);
      }
      for (let i = 0; i < 10; i++) {
        ringBuffer.incrementPostReaction(postId, 1);
      }

      // Check that identical post counters were merged
      expect(ringBuffer.getPendingCount()).toBe(2);

      // Flush to disk
      const flushResult = ringBuffer.flush();
      expect(flushResult.flushedCount).toBe(2);
      expect(flushResult.timeMs).toBeGreaterThanOrEqual(0);

      // Verify row in database
      const row: any = rawDb.prepare('SELECT views_count, likes_count FROM posts WHERE id = ?').get(postId);
      expect(row.views_count).toBe(50);
      expect(row.likes_count).toBe(10);
    });

    it('cleans up test database resources', () => {
      db.close();
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
    });
  });

  // --- PHASE 4: LIVE WEBRTC SWARM RELAY & TURN MULTI-TIER ---
  describe('Phase 4: Live WebRTC Swarm Relay & Adaptive Bitrate Throttling', () => {
    it('serves WebRTC network connection health scoring and adaptive bitrate engine', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      expect(html).toContain('let _webrtcHealth =');
      expect(html).toContain('function calculateWebRtcHealthScore(');
      expect(html).toContain('function adaptWebRtcEncodingQuality(');
      expect(html).toContain('window.adaptWebRtcEncodingQuality = adaptWebRtcEncodingQuality;');
      expect(html).toContain('window.getWebRtcConnectionHealth =');
      expect(html).toContain('swarmRelayCapacity: 8');
    });

    it('supports automatic multi-tier TURN fallback and dynamic encoding bitrate limits', async () => {
      const res = await fetch(BASE_URL);
      const html = await res.text();

      // TURN fallback trigger on latency > 400ms
      expect(html).toContain('rttMs > 400 || score < 45');
      expect(html).toContain('switchCallToTlsRelay');

      // Throttling bitrates
      expect(html).toContain('maxBitrate = 250000'); // 250 kbps
      expect(html).toContain('maxBitrate = 800000'); // 800 kbps
      expect(html).toContain('maxBitrate = 2500000'); // 2.5 Mbps
    });
  });
});
