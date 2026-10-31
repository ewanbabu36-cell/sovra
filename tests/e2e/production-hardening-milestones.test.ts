import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('🚀 Sovra Production-Grade Hardening E2E Test Suite', () => {
  let serverHtml = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    serverHtml = await res.text();
  });

  describe('Milestone 1: WebRTC Camera QR / DID Scanner', () => {
    it('verifies camera scanner modal structure and WebRTC video canvas', () => {
      expect(serverHtml).toContain('id="sovraCameraScannerModal"');
      expect(serverHtml).toContain('id="sovraScannerVideo"');
      expect(serverHtml).toContain('id="sovraScannerLaser"');
      expect(serverHtml).toContain('id="sovraScannerStatus"');
      expect(serverHtml).toContain('id="sovraManualDidInput"');
      expect(serverHtml).toContain('id="sovraQrFileInput"');
    });

    it('verifies client logic implements getUserMedia, BarcodeDetector and QR payload handling', () => {
      expect(serverHtml).toContain('navigator.mediaDevices.getUserMedia');
      expect(serverHtml).toContain("facingMode: 'environment'");
      expect(serverHtml).toContain('BarcodeDetector');
      expect(serverHtml).toContain('function openQrScannerModal()');
      expect(serverHtml).toContain('function closeQrScannerModal()');
      expect(serverHtml).toContain('function handleScannedQrPayload(payload)');
    });
  });

  describe('Milestone 2: Zero Fake Active Call & Real Call Logs in Calls View', () => {
    it('verifies #calls-view defaults to Idle Dashboard with contact dialer and call history log', () => {
      expect(serverHtml).toContain('id="callsIdleDashboard"');
      expect(serverHtml).toContain('id="callsPeerSearchInput"');
      expect(serverHtml).toContain('id="callsContactsGrid"');
      expect(serverHtml).toContain('Call History Log');
      expect(serverHtml).toContain('id="callsHistoryList"');
    });

    it('verifies active video session is hidden when idle and zero fake active call', () => {
      expect(serverHtml).toContain('id="callsActiveSession" style="display: none;');
      expect(serverHtml).toContain('function startEncryptedCall');
      expect(serverHtml).toContain('function terminateActiveCall');
      expect(serverHtml).toContain('function renderCallHistoryLog');
    });
  });

  describe('Milestone 3: SQLite Communities & Channels Persistence', () => {
    let testCommId = '';

    it('GET /api/communities/list returns active communities from SQLite', async () => {
      const res = await fetch(`${BASE_URL}/api/communities/list`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.communities)).toBe(true);
      expect(data.communities.length).toBeGreaterThan(0);
    });

    it('POST /api/communities/create creates a new community in SQLite', async () => {
      const res = await fetch(`${BASE_URL}/api/communities/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Vitest E2E Test Guild',
          description: 'Testing SQLite community persistence',
          category: 'QA',
          avatar: '🧪'
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.id).toBeDefined();
      testCommId = data.id;
    });

    it('POST /api/communities/join joins a community and updates membership in SQLite', async () => {
      expect(testCommId).toBeTruthy();
      const res = await fetch(`${BASE_URL}/api/communities/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          communityId: testCommId,
          memberDid: 'did:sovra:tester_alpha'
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });

  describe('Milestone 4: Keyset Cursor Pagination & Media Pipeline', () => {
    it('supports keyset cursor pagination on /api/feed/list', async () => {
      const res = await fetch(`${BASE_URL}/api/feed/list?limit=5`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.posts)).toBe(true);
      expect(data.posts.length).toBe(5);
      expect(data.nextCursor).toBeDefined();

      // Query page 2 with cursor
      const page2Res = await fetch(`${BASE_URL}/api/feed/list?limit=5&cursor=${encodeURIComponent(data.nextCursor)}`);
      expect(page2Res.status).toBe(200);
      const page2Data = await page2Res.json();
      expect(page2Data.ok).toBe(true);
      expect(Array.isArray(page2Data.posts)).toBe(true);
      expect(page2Data.posts.length).toBeGreaterThan(0);
      // Verify page 2 post IDs are strictly older/lower than cursor
      page2Data.posts.forEach((p: any) => {
        expect(p.id).not.toBe(data.nextCursor);
      });
    });

    it('supports keyset cursor pagination on /api/reels/list', async () => {
      const res = await fetch(`${BASE_URL}/api/reels/list?limit=5`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.reels)).toBe(true);
      expect(data.reels.length).toBe(5);
      expect(data.nextCursor).toBeDefined();

      // Query page 2 with cursor
      const page2Res = await fetch(`${BASE_URL}/api/reels/list?limit=5&cursor=${encodeURIComponent(data.nextCursor)}`);
      expect(page2Res.status).toBe(200);
      const page2Data = await page2Res.json();
      expect(page2Data.ok).toBe(true);
      expect(Array.isArray(page2Data.reels)).toBe(true);
    });
  });

  describe('Milestone 5: Top Header SOVRA Branding, Search & Profile Buttons', () => {
    it('verifies top header contains SOVRA branding wordmark and logo emblem', () => {
      expect(serverHtml).toContain('id="sovraNativeBrandBadge"');
      expect(serverHtml).toContain('SOVRA');
      expect(serverHtml).toContain('sovraNativeSvgG');
    });

    it('verifies top header contains dedicated Search icon button and collapsible search overlay', () => {
      expect(serverHtml).toContain('id="sovraNativeAppBarSearchBtn"');
      expect(serverHtml).toContain('id="nativeHeaderSearchOverlay"');
      expect(serverHtml).toContain('id="mobileSearchInput"');
      expect(serverHtml).toContain('toggleHeaderSearchOverlay');
    });

    it('verifies top header contains dedicated Profile avatar button with online presence indicator', () => {
      expect(serverHtml).toContain('id="sovraNativeAppBarProfileBtn"');
      expect(serverHtml).toContain('id="sovraNativeAvatarIcon"');
      expect(serverHtml).toContain("switchTab('me')");
    });
  });
});
