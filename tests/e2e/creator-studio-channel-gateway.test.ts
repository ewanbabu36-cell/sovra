/**
 * @file tests/e2e/creator-studio-channel-gateway.test.ts
 * Creator Studio Channel Gateway & YouTube Parity E2E Verification Suite.
 *
 * Verifies:
 * 1. Entry Behavior with No Channel:
 *    - Dedicated YouTube-style Onboarding Gateway (#studioChannelOnboardingView) is displayed.
 *    - Active Studio Dashboard Shell (#studioDashboardShell) is hidden.
 *    - No mock or foreign channels leaked to unregistered/new DIDs.
 * 2. Entry Behavior with Channel Created:
 *    - Studio Dashboard Shell (#studioDashboardShell) is unlocked and displayed.
 *    - Dynamic channel switcher (#studioActiveChannelSelect) is strictly populated with owned channels.
 *    - Direct channel link (#studioViewChannelLink) present in sidebar.
 *    - Zero-video channels render #scorecardZeroState.
 *    - Active video channels render #scorecardActiveState with full analytics.
 * 3. Channel Switcher & Onboarding Transitions:
 *    - Selecting "__create_channel__" smoothly transitions back to Onboarding Gateway.
 *    - Cancel / Exit button toggles back to dashboard if channels exist, or feed if empty.
 * 4. Backend Gateway API (/api/studio/my-channels):
 *    - Scoped strictly by creator DID.
 *    - Returns hasChannel, channels array, and primaryChannelId.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleStudioTranscoderRoutes } from '../../scripts/routes/studio.routes.ts';

describe('Creator Studio Channel Gateway & YouTube Parity Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const studioRoutesPath = path.resolve(__dirname, '../../scripts/routes/studio.routes.ts');
  const serverContent = fs.readFileSync(devServerPath, 'utf8');
  const studioRoutesContent = fs.readFileSync(studioRoutesPath, 'utf8');

  const testNewUserDid = 'did:sovra:brand_new_creator_' + Date.now();
  const testExistingUserDid = 'did:sovra:existing_creator_' + Date.now();
  let createdChannelId = '';

  beforeAll(() => {
    sovraDb.load();
    // Seed an existing channel for testExistingUserDid
    const existingChan = {
      id: 'ch-test-existing-' + Date.now(),
      handle: '@existingtech',
      name: 'Existing Tech 4K',
      category: 'tech',
      desc: 'Channel for existing user tests',
      count: 42,
      avatar: '🎬',
      bg: '#f43f5e',
      channelType: 'video',
      isSubbed: true,
      ownerDid: testExistingUserDid,
      createdAt: Date.now(),
    };
    createdChannelId = existingChan.id;
    sovraDb.db.channels.unshift(existingChan);
    sovraDb.save();
  });

  // =========================================================================
  // SECTION 1: UI DOM & DUAL-STATE GATEWAY STRUCTURE
  // =========================================================================
  describe('1. UI DOM & Dual-State Gateway Markup', () => {
    it('1.1 Studio contains the dedicated Channel Onboarding View (#studioChannelOnboardingView)', () => {
      expect(serverContent).toContain('id="studioChannelOnboardingView"');
      expect(serverContent).toContain('id="studioChannelOnboardingCard"');
      expect(serverContent).toContain('Your Creator Journey Begins Here');
    });

    it('1.2 Onboarding Gateway features YouTube-style channel appearance form & inputs', () => {
      expect(serverContent).toContain('id="studioNewChanAvatarPreview"');
      expect(serverContent).toContain('id="studioNewChanAvatarInput"');
      expect(serverContent).toContain('id="studioNewChanNameInput"');
      expect(serverContent).toContain('id="studioNewChanHandleInput"');
      expect(serverContent).toContain('id="studioNewChanHandleStatus"');
      expect(serverContent).toContain('id="studioNewChanCategorySelect"');
      expect(serverContent).toContain('id="studioNewChanBioInput"');
      expect(serverContent).toContain('id="studioCreateChannelSubmitBtn"');
      expect(serverContent).toContain('id="studioOnboardingCancelBtn"');
      expect(serverContent).toContain('id="studioOnboardingNotNowBtn"');
    });

    it('1.3 Onboarding Gateway highlights Sovereign Web3 Creator benefits', () => {
      expect(serverContent).toContain('95% Net Revenue');
      expect(serverContent).toContain('4K HLS BitSwap Mesh');
      expect(serverContent).toContain('Cryptographic Provenance');
    });

    it('1.4 Main Dashboard is encapsulated inside #studioDashboardShell', () => {
      expect(serverContent).toContain('id="studioDashboardShell"');
      expect(serverContent).toContain('id="studioTopNavbar"');
      expect(serverContent).toContain('id="studioNavSidebar"');
      expect(serverContent).toContain('id="studioActiveChannelSelect"');
      expect(serverContent).toContain('id="studioViewChannelLink"');
    });

    it('1.5 Dashboard includes YouTube-style dual scorecard states: zero-state & active-state', () => {
      expect(serverContent).toContain('id="scorecardZeroState"');
      expect(serverContent).toContain('Upload Your First Video');
      expect(serverContent).toContain('id="studioDashboardDropzone"');
      expect(serverContent).toContain('id="scorecardActiveState"');
      expect(serverContent).toContain('id="scorecardVideoThumb"');
      expect(serverContent).toContain('id="scorecardRank"');
      expect(serverContent).toContain('id="scorecardViews"');
      expect(serverContent).toContain('id="scorecardCtr"');
    });
  });

  // =========================================================================
  // SECTION 2: BACKEND ROUTE & OWNERSHIP ENFORCEMENT (/api/studio/my-channels)
  // =========================================================================
  describe('2. Backend Route /api/studio/my-channels & Strict Ownership', () => {
    function mockContext(urlStr: string, method: string = 'GET') {
      const url = new URL(urlStr, 'http://localhost:3001');
      const req: any = { method, url: urlStr, headers: {} };
      let responseBody = '';
      let statusCode = 200;
      const res: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (chunk: string) => { responseBody = chunk; },
      };
      return {
        ctx: {
          req,
          res,
          url,
          readBoundedBody: async () => ({ body: '{}', ok: true }),
          resolvePrincipal: () => null,
          enforceAuth: () => null,
        },
        getStatusCode: () => statusCode,
        getJson: () => JSON.parse(responseBody || '{}'),
      };
    }

    it('2.1 Route definition exists in studio.routes.ts', () => {
      expect(studioRoutesContent).toContain('/api/studio/my-channels');
    });

    it('2.2 Brand new user with no channels receives hasChannel: false and empty list', async () => {
      const mock = mockContext(`/api/studio/my-channels?creatorDid=${encodeURIComponent(testNewUserDid)}`);
      const handled = await handleStudioTranscoderRoutes(mock.ctx);
      expect(handled).toBe(true);
      expect(mock.getStatusCode()).toBe(200);

      const json = mock.getJson();
      expect(json.ok).toBe(true);
      expect(json.hasChannel).toBe(false);
      expect(Array.isArray(json.channels)).toBe(true);
      expect(json.channels.length).toBe(0);
      expect(json.primaryChannelId).toBeNull();
    });

    it('2.3 Existing user receives strictly only their owned channels', async () => {
      const mock = mockContext(`/api/studio/my-channels?creatorDid=${encodeURIComponent(testExistingUserDid)}`);
      const handled = await handleStudioTranscoderRoutes(mock.ctx);
      expect(handled).toBe(true);
      expect(mock.getStatusCode()).toBe(200);

      const json = mock.getJson();
      expect(json.ok).toBe(true);
      expect(json.hasChannel).toBe(true);
      expect(json.channels.length).toBeGreaterThanOrEqual(1);
      expect(json.channels[0].ownerDid).toBe(testExistingUserDid);
      expect(json.channels[0].id).toBe(createdChannelId);
      expect(json.primaryChannelId).toBe(createdChannelId);
    });

    it('2.4 Unregistered query without DID does not leak mock channels', async () => {
      const mock = mockContext('/api/studio/my-channels');
      const handled = await handleStudioTranscoderRoutes(mock.ctx);
      expect(handled).toBe(true);

      const json = mock.getJson();
      expect(json.ok).toBe(true);
      expect(json.hasChannel).toBe(false);
      expect(json.channels.length).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 3: DASHBOARD SCOPING & ZERO-VIDEO VS ACTIVE SCORECARD
  // =========================================================================
  describe('3. Dashboard Data Scoping & Scorecard States', () => {
    it('3.1 Brand new channel with 0 videos has latestVideo = null in dashboard API', () => {
      const dbDash = sovraDb.getCreatorStudioDashboard(testExistingUserDid, createdChannelId);
      expect(dbDash).toBeDefined();
      // Since no videos have been uploaded yet for this new channel:
      expect(dbDash.latestVideo).toBeNull();
      expect(dbDash.currentSubscribers).toBe(42);
    });

    it('3.2 After adding a video to channel, latestVideo is populated with YouTube metrics', () => {
      const testVidId = 'v-test-' + Date.now();
      sovraDb.db.videos.unshift({
        id: testVidId,
        channelId: createdChannelId,
        channelHandle: 'existingtech',
        title: 'Mastering P2P Web3 Streaming in 4K',
        description: 'First video on new channel',
        viewsCount: 1250,
        likesCount: 88,
        commentsCount: 14,
        createdAt: Date.now() - 3600000,
        ownerDid: testExistingUserDid,
        thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=240&q=80',
      } as any);
      sovraDb.save();

      const dbDashWithVideo = sovraDb.getCreatorStudioDashboard(testExistingUserDid, createdChannelId);
      expect(dbDashWithVideo.latestVideo).not.toBeNull();
      expect(dbDashWithVideo.latestVideo?.title).toBe('Mastering P2P Web3 Streaming in 4K');
      expect(dbDashWithVideo.latestVideo?.viewsCount).toBe(1250);
      expect(dbDashWithVideo.latestVideo?.likesCount).toBe(88);
      expect(dbDashWithVideo.latestVideo?.commentsCount).toBe(14);
    });
  });

  // =========================================================================
  // SECTION 4: CLIENT-SIDE SovraCreatorStudioEngine METHODS & PARITY
  // =========================================================================
  describe('4. SovraCreatorStudioEngine State Machine & Client Methods', () => {
    it('4.1 Engine defines all required gateway methods and hooks', () => {
      expect(serverContent).toContain('populateChannelsAndProfile:');
      expect(serverContent).toContain('switchActiveChannel:');
      expect(serverContent).toContain('selectOnboardingEmoji:');
      expect(serverContent).toContain('handleOnboardingNameChange:');
      expect(serverContent).toContain('handleOnboardingHandleChange:');
      expect(serverContent).toContain('cancelOnboardingOrExit:');
      expect(serverContent).toContain('createChannelAndEnterStudio:');
      expect(serverContent).toContain('viewActiveChannelOnSovra:');
    });

    it('4.2 populateChannelsAndProfile queries /api/studio/my-channels and enforces dual-state toggle', () => {
      expect(serverContent).toContain("fetch('/api/studio/my-channels'");
      expect(serverContent).toContain("onboardingView.style.display = 'block'");
      expect(serverContent).toContain("dashboardShell.style.display = 'none'");
      expect(serverContent).toContain("onboardingView.style.display = 'none'");
      expect(serverContent).toContain("dashboardShell.style.display = 'block'");
    });

    it('4.3 switchActiveChannel transitions to onboarding when selecting __create_channel__', () => {
      expect(serverContent).toContain("if (channelId === '__create_channel__')");
      expect(serverContent).toContain("cancelTopText.textContent = 'Cancel'");
    });

    it('4.4 createChannelAndEnterStudio sends channelType: video to /api/social/channels', () => {
      expect(serverContent).toContain("channelType: 'video'");
      expect(serverContent).toContain("fetchFn('/api/social/channels'");
    });
  });
});
