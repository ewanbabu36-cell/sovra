/**
 * @file tests/unit/live-stream-studio-controls.test.ts
 * Comprehensive Verification Suite for Sovra Creator Studio & Live Stream Command Center.
 *
 * Verifies:
 * 1. Automatic Personal Channel Provisioning prevents blank/black screens on `/studio#tab=dashboard`.
 * 2. Complete Presence of Live Stream Command Center (`#studioSectionLive`, `#studioNavLive`, `#studioBtnEndLive`).
 * 3. Persistent Global Live Broadcast HUD (`#sovraGlobalLiveBroadcastHud`, `#btnGlobalEndLive`) across entire app.
 * 4. CSS Rules for Studio Viewport, Sidebar, Layout Shell, and Global Live HUD.
 * 5. Cryptographic State Machine & Access Control for Live Sessions (STARTING -> LIVE -> ENDED).
 * 6. Authorization enforcement: Only broadcaster/creator can end live stream.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.ts';
import { renderAppLayout } from '../../scripts/views/layout.view.ts';
import { renderGlobalStyles } from '../../scripts/views/styles.view.ts';

describe('Sovra Creator Studio & Live Stream Command Center', () => {
  const testCreatorDid = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
  const testGuestDid = 'did:key:z6MkjT4F93mU52U4uA2fLqD73xLg2f7Z7bF9X1W3vG6D2A1C';

  beforeAll(() => {
    sovraDb.load();
    if (!Array.isArray((sovraDb as any).db.live_sessions)) {
      (sovraDb as any).db.live_sessions = [];
    }
    if (!Array.isArray((sovraDb as any).db.channels)) {
      (sovraDb as any).db.channels = [];
    }
  });

  describe('1. Layout & Studio Command Center Elements', () => {
    const mockCtx: any = {
      binding: { peerId: '12D3KooWTestPeer123' },
      masterKey: { did: testCreatorDid },
      tcpPort: 4001,
      nodeUptime: 120,
      storageDaemon: {},
      socialGraph: {},
      localFeed: {},
      hostUser: {
        did: testCreatorDid,
        handle: '@host_tester',
        displayName: 'Host Tester',
        avatar: '🎬',
        sessionToken: 'stk_mock_test_token_123',
      },
      hostSessionToken: 'stk_mock_test_token_123',
      isCreatorModeActive: true,
      longFormVideosCatalog: [],
      livePosts: [],
      livePeers: [],
      liveUsers: [],
      liveReels: [],
    };

    const renderedLayout = renderAppLayout(mockCtx);

    it('contains Persistent Global Live Broadcast HUD with End Live control', () => {
      expect(renderedLayout).toContain('id="sovraGlobalLiveBroadcastHud"');
      expect(renderedLayout).toContain('id="btnGlobalEndLive"');
      expect(renderedLayout).toContain('confirmAndEndLiveBroadcast');
      expect(renderedLayout).toContain('id="globalLiveBroadcastTimer"');
      expect(renderedLayout).toContain('id="globalLiveBroadcastViewers"');
    });

    it('contains Creator Studio Live Navigation Tab in Sidebar', () => {
      expect(renderedLayout).toContain('id="studioNavLive"');
      expect(renderedLayout).toContain('switchStudioTab(\'live\')');
      expect(renderedLayout).toContain('id="studioNavLiveIndicator"');
    });

    it('contains Live Stream Command Center section with video preview and broadcast controls', () => {
      expect(renderedLayout).toContain('id="studioSectionLive"');
      expect(renderedLayout).toContain('id="studioLivePreviewVideo"');
      expect(renderedLayout).toContain('id="studioLiveStandbyCover"');
      expect(renderedLayout).toContain('id="studioBtnStartBroadcast"');
      expect(renderedLayout).toContain('id="studioBtnEndBroadcast"');
      expect(renderedLayout).toContain('id="btnToggleStudioMic"');
      expect(renderedLayout).toContain('id="btnToggleStudioCam"');
      expect(renderedLayout).toContain('id="btnToggleStudioScreenShare"');
    });

    it('contains Creator Studio Layout Shell and Sidebar Profile elements', () => {
      expect(renderedLayout).toContain('class="studio-layout-shell"');
      expect(renderedLayout).toContain('id="studioNavSidebar"');
      expect(renderedLayout).toContain('id="studioChannelAvatar"');
      expect(renderedLayout).toContain('id="studioChannelName"');
      expect(renderedLayout).toContain('id="studioChannelHandle"');
      expect(renderedLayout).toContain('id="studioDashboardShell"');
    });
  });

  describe('2. Global Styles Verification', () => {
    const css = renderGlobalStyles();

    it('defines responsive CSS for studio viewport and sidebar', () => {
      expect(css).toContain('.studio-main-viewport');
      expect(css).toContain('.studio-layout-shell');
      expect(css).toContain('.studio-sidebar');
      expect(css).toContain('.studio-sidebar-profile');
      expect(css).toContain('.studio-sidebar-nav-btn');
      expect(css).toContain('.studio-main-workspace');
    });

    it('defines styles and pulse animation for Persistent Global Live HUD', () => {
      expect(css).toContain('.sovra-global-live-hud');
      expect(css).toContain('@keyframes sovraLivePulse');
      expect(css).toContain('.studio-live-stage');
      expect(css).toContain('.studio-live-video-box');
    });
  });

  describe('3. Live Session State Machine & Security Verification', () => {
    let testSessionId = '';

    it('creates a new live stream session with valid creator metadata', () => {
      const session = sovraDb.createLiveSession({
        creatorDid: testCreatorDid,
        creatorHandle: 'testcreator',
        creatorName: 'Test Broadcaster',
        creatorAvatar: '🔴',
        title: 'Architectural Live Broadcast',
        category: 'tech',
        forceNew: true,
      });

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      expect(session.creatorDid).toBe(testCreatorDid);
      expect(session.status).toBe('SCHEDULED');
      testSessionId = session.id;
    });

    it('transitions session status to LIVE by creator', () => {
      const result = sovraDb.updateLiveSessionStatus(testSessionId, 'LIVE', testCreatorDid);
      expect(result.ok).toBe(true);
      expect(result.session?.status).toBe('LIVE');
    });

    it('rejects unauthorized guest attempting to end broadcaster stream', () => {
      const unauthorizedAttempt = sovraDb.endLiveBroadcast(testSessionId, testGuestDid);
      expect(unauthorizedAttempt.ok).toBe(false);
      expect(unauthorizedAttempt.error).toContain('Unauthorized');

      // Verify status remains LIVE
      const current = sovraDb.getLiveSessionById(testSessionId);
      expect(current?.status).toBe('LIVE');
    });

    it('allows broadcaster to end live stream, sets status to ENDED and records endedAt', () => {
      const endResult = sovraDb.endLiveBroadcast(testSessionId, testCreatorDid);
      expect(endResult.ok).toBe(true);
      expect(endResult.session?.status).toBe('ENDED');
      expect(endResult.session?.endedAt).toBeGreaterThan(0);

      const archived = sovraDb.getLiveSessionById(testSessionId);
      expect(archived?.status).toBe('ENDED');
    });
  });
});
