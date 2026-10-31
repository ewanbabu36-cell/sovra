import { describe, it, expect, beforeAll } from 'vitest';
import { SovraSqliteEngine } from '../../scripts/database-sqlite.ts';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = 'http://localhost:3001';

describe('🚀 Sovra Enterprise Zero-Mock Production Hardening Suite (Phases 1 - 5)', () => {
  let sqlite: SovraSqliteEngine;
  const testStorageDir = path.join(process.cwd(), '.sovra_test_zero_mock');

  beforeAll(() => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    sqlite = new SovraSqliteEngine(testStorageDir);
  });

  // =========================================================================
  // PHASE 1: SQLITE SCHEMAS & MOCK SEED ISOLATION
  // =========================================================================
  describe('Phase 1: Persistent SQLite Tables & Isolation', () => {
    it('creates call_logs table and records/retrieves persistent call logs', () => {
      const logged = sqlite.recordCallLog({
        callerDid: 'did:sovra:alice_tester',
        calleeDid: 'did:sovra:bob_tester',
        callType: 'video',
        status: 'completed',
        durationSeconds: 42
      });
      expect(logged).toBe(true);

      const logs = sqlite.getCallLogs({ did: 'did:sovra:alice_tester' });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].caller_did).toBe('did:sovra:alice_tester');
      expect(logs[0].callee_did).toBe('did:sovra:bob_tester');
      expect(logs[0].call_type).toBe('video');
      expect(logs[0].duration_seconds).toBe(42);
    });

    it('creates video_views table and calculates views dynamically', () => {
      const vidId = 'vid_unit_test_' + Date.now();
      const viewRecorded = sqlite.recordVideoView({
        videoId: vidId,
        viewerDid: 'did:sovra:viewer_123',
        ipHash: 'abc123hash'
      });
      expect(viewRecorded).toBe(true);

      const count = sqlite.getVideoViewsCount(vidId);
      expect(count).toBe(1);
    });

    it('creates analytics_events table and stores telemetry events', () => {
      const eventRecorded = sqlite.recordAnalyticsEvent({
        eventType: 'TEST_TELEMETRY',
        userDid: 'did:sovra:telemetry_user',
        metadataJson: JSON.stringify({ rttMs: 18, bytesSent: 1024 })
      });
      expect(eventRecorded).toBe(true);

      const events = sqlite.getAnalyticsEvents('TEST_TELEMETRY');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].user_did).toBe('did:sovra:telemetry_user');
    });

    it('defaults user balance to 0.00 SOV in users table', () => {
      const testDid = 'did:sovra:new_zero_user_' + Date.now();
      sqlite.registerUser({
        did: testDid,
        handle: 'zero_' + Date.now(),
        displayName: 'Zero User',
        avatar: '👤',
        avatarBg: '#6366f1'
      });
      const user = sqlite.getUserByDid(testDid);
      expect(user).toBeTruthy();
      expect(user?.balanceSov).toBe(0.0);
    });
  });

  // =========================================================================
  // PHASE 2: REAL MESSENGER & CALL HISTORY API
  // =========================================================================
  describe('Phase 2: Real Messenger & Persistent Call History Endpoints', () => {
    it('GET /api/chat/conversations returns dynamic conversations array', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/conversations?did=did:sovra:host`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.conversations)).toBe(true);
      expect(typeof data.count).toBe('number');
    });

    it('POST /api/calls/log records a real call and GET /api/calls/history retrieves it', async () => {
      const calleeDid = 'did:sovra:peer_e2e_' + Date.now();
      const logRes = await fetch(`${BASE_URL}/api/calls/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerDid: 'did:sovra:host',
          calleeDid,
          callType: 'audio',
          status: 'completed',
          durationSeconds: 125
        })
      });
      expect(logRes.status).toBe(200);
      const logData = await logRes.json();
      expect(logData.ok).toBe(true);
      expect(logData.id).toBeTruthy();

      const histRes = await fetch(`${BASE_URL}/api/calls/history?did=${calleeDid}`);
      expect(histRes.status).toBe(200);
      const histData = await histRes.json();
      expect(histData.ok).toBe(true);
      expect(histData.calls.some((c: any) => c.callee_did === calleeDid)).toBe(true);
    });

    it('HTML serves clean floating toast with zero hardcoded message strings', async () => {
      const res = await fetch(`${BASE_URL}/`);
      const html = await res.text();
      expect(html).toContain('id="floatingChatToast"');
      expect(html).toContain('style="display: none;"');
      expect(html).not.toContain('<div class="toast-msg" id="toastMsg">Hey, are you free right now?</div>');
    });
  });

  // =========================================================================
  // PHASE 3: ZERO-BALANCE CRYPTOGRAPHIC LEDGER & TESTNET FAUCET
  // =========================================================================
  describe('Phase 3: Zero-Balance Ledger & Testnet Faucet', () => {
    it('serves Claim Testnet Faucet action button in wallet view', async () => {
      const res = await fetch(`${BASE_URL}/`);
      const html = await res.text();
      expect(html).toContain('id="btnClaimTestnetFaucet"');
      expect(html).toContain('Claim Faucet (+50 SOV)');
    });

    it('POST /api/wallet/faucet/claim credits 50 SOV and enforces rate limiting', async () => {
      const uniqueDid = 'did:sovra:faucet_claimer_' + Date.now();
      
      // First claim succeeds
      const res1 = await fetch(`${BASE_URL}/api/wallet/faucet/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: uniqueDid })
      });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.ok).toBe(true);
      expect(data1.claimed || data1.amount || data1.claimedAmount).toBe(50.0);

      // Second claim within 24h is rate-limited with 429
      const res2 = await fetch(`${BASE_URL}/api/wallet/faucet/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: uniqueDid })
      });
      expect(res2.status).toBe(429);
      const data2 = await res2.json();
      expect(data2.ok).toBe(false);
      expect(data2.error).toContain('Faucet rate limit reached');
    });
  });

  // =========================================================================
  // PHASE 4: DYNAMIC METRICS, VIEWS & SUBSCRIBERS
  // =========================================================================
  describe('Phase 4: Dynamic Metrics & View Tracking', () => {
    it('POST /api/watch/view records view and updates dynamic views count', async () => {
      const testVideoId = 'yt_phase4_' + Date.now();
      const res = await fetch(`${BASE_URL}/api/watch/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: testVideoId,
          viewerDid: 'did:sovra:stream_viewer'
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.viewsCount).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/youtube/video calculates views dynamically', async () => {
      const res = await fetch(`${BASE_URL}/api/youtube/video?id=yt-video-1`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.video).toBeTruthy();
      expect(typeof data.video.views).toBe('number');
    });
  });

  // =========================================================================
  // PHASE 5: REAL-TIME SSE & CLEAN EMPTY STATES
  // =========================================================================
  describe('Phase 5: Real-time SSE & Clean Empty States', () => {
    it('HTML initializes dedicatedNotificationsStore as empty array without fake seed notifications', async () => {
      const res = await fetch(`${BASE_URL}/`);
      const html = await res.text();
      expect(html).toContain('const defaultSeedNotifications = [];');
      expect(html).not.toContain('liked your post "Cellular CGNAT Traversal Benchmarks on 5G"');
    });

    it('HTML includes authentic empty states for zero-record categories', async () => {
      const res = await fetch(`${BASE_URL}/`);
      const html = await res.text();
      expect(html).toContain('No Notifications');
      expect(html).toContain('No calls in this category.');
    });
  });
});
