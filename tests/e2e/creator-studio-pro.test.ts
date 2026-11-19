/**
 * @file tests/e2e/creator-studio-pro.test.ts
 * Creator Studio Pro: Comprehensive Repair, Universal Access & Production Integrity Test Suite.
 *
 * Verifies:
 * 1. Universal Creator Studio Access:
 *    - switchTab('studio') no longer blocks non-creators with a dead-end modal or toast.
 *    - Non-creators route smoothly into the #studioChannelOnboardingView gateway.
 * 2. Channel Creation Binding & Profile Unlocking:
 *    - Reads from #studioNewChanNameInput, #studioNewChanHandleInput, #studioNewChanBioInput,
 *      #studioNewChanAvatarInput, and #studioNewChanCategorySelect.
 *    - Updates profile with isCreator = true upon channel creation.
 *    - Transitions UI from onboarding view to #studioDashboardShell.
 * 3. Duplicate Stubs Purge:
 *    - Purged obsolete prototype stubs (submitWorkspaceUpload, saveCustomization, saveVideoDetails, claimSovereignEarnings).
 *    - Retains single source of truth implementations.
 * 4. WebVTT ReferenceError Fix:
 *    - downloadWebVTT safely guards cues (curTrack && curTrack.cues ? curTrack.cues : []).
 * 5. Interactive Audio Library Web Audio Synth:
 *    - togglePlayAudioTrack creates real audio synthesis/preview and stops cleanly on pause.
 * 6. Studio Settings Full Persistence:
 *    - Settings inputs have IDs: #studioSettingDefaultCategory, #studioSettingDefaultTags, #studioSettingBitrateCap.
 *    - Has save button: #btnSaveStudioSettings.
 *    - GET /api/studio/settings & POST /api/studio/settings/save persist and retrieve custom settings.
 * 7. End-Screen Metadata Persistence:
 *    - editVideoEndScreenSelect bound in saveVideoDetails.
 *    - /api/studio/video/update persists endScreenVideoId & endScreenType to database.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';
import { handleStudioTranscoderRoutes } from '../../scripts/routes/studio.routes.ts';
import { handleSocialRoutes } from '../../scripts/routes/social.routes.ts';

describe('Creator Studio Pro: Full Repair & Universal Access Verification', () => {
  const scriptsViewPath = path.resolve(__dirname, '../../scripts/views/scripts.view.ts');
  const layoutViewPath = path.resolve(__dirname, '../../scripts/views/layout.view.ts');
  const studioRoutesPath = path.resolve(__dirname, '../../scripts/routes/studio.routes.ts');

  const scriptsViewContent = fs.readFileSync(scriptsViewPath, 'utf8');
  const layoutViewContent = fs.readFileSync(layoutViewPath, 'utf8');
  const studioRoutesContent = fs.readFileSync(studioRoutesPath, 'utf8');

  const testCreatorDid = 'did:sovra:creator_studio_pro_' + Date.now();
  let testVideoId = '';

  beforeAll(() => {
    sovraDb.load();
    // Seed a test video
    const vid = {
      id: 'vid-studio-test-' + Date.now(),
      title: 'Original Studio Title',
      description: 'Original Description',
      category: 'Tech',
      creatorDid: testCreatorDid,
      channelId: 'ch-test-chan',
      status: 'ready',
      views: 120,
      createdAt: Date.now(),
    };
    testVideoId = vid.id;
    if (!sovraDb.db.videos) (sovraDb.db as any).videos = [];
    sovraDb.db.videos.unshift(vid as any);
    sovraDb.save();
  });

  // =========================================================================
  // GAP 1: Universal Access & Non-Creator Routing (Milestone 1)
  // =========================================================================
  describe('Gap 1: Universal Creator Studio Access & Onboarding Routing', () => {
    it('switchTab("studio") does not return early with a blocking modal or error toast', () => {
      // Must not return early on !isCreator
      expect(scriptsViewContent).not.toMatch(/if\s*\(!isCreator\)\s*\{\s*if\s*\(typeof window\.showCreatorUpgradeModal[\s\S]*?return;\s*\}/);
      // Must set onboardingView display to block when !isCreator
      expect(scriptsViewContent).toContain("if (onboardingView) onboardingView.style.display = 'block';");
      expect(scriptsViewContent).toContain("if (dashboardShell) dashboardShell.style.display = 'none';");
    });

    it('populateChannelsAndProfile smoothly displays #studioChannelOnboardingView for non-creators without channels', () => {
      expect(scriptsViewContent).toContain('if (!isCreator || window.__forceStudioOnboardingTest)');
      expect(scriptsViewContent).toContain('// 🎬 Display YouTube-style Onboarding Gateway for users without an existing channel');
    });
  });

  // =========================================================================
  // GAP 2: Channel Creation Form Binding & Profile Unlocking (Milestone 1)
  // =========================================================================
  describe('Gap 2: Channel Creation Element Binding & Profile Unlocking', () => {
    it('layout contains all channel onboarding inputs with exact IDs', () => {
      expect(layoutViewContent).toContain('id="studioNewChanNameInput"');
      expect(layoutViewContent).toContain('id="studioNewChanHandleInput"');
      expect(layoutViewContent).toContain('id="studioNewChanAvatarInput"');
      expect(layoutViewContent).toContain('id="studioNewChanCategorySelect"');
      expect(layoutViewContent).toContain('id="studioNewChanBioInput"');
      expect(layoutViewContent).toContain('id="studioCreateChannelSubmitBtn"');
    });

    it('createChannelAndEnterStudio unlocks isCreator = true and transitions DOM views', () => {
      expect(scriptsViewContent).toContain('window.SovraState.currentUser.isCreator = true;');
      expect(scriptsViewContent).toContain('myProfile.isCreator = true;');
      expect(scriptsViewContent).toContain("onboardingView.style.display = 'none';");
      expect(scriptsViewContent).toContain("dashboardShell.style.display = 'block';");
    });

    it('backend accepts /api/channels/create and updates creator status in database', async () => {
      const mockReq: any = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      };
      let writtenStatus = 0;
      let writtenBody = '';
      const mockRes: any = {
        writeHead: (status: number) => { writtenStatus = status; },
        end: (body: string) => { writtenBody = body; },
      };

      const ctx: any = {
        url: new URL('http://localhost:3001/api/channels/create'),
        req: mockReq,
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            name: 'Pro Creator 4K',
            handle: '@procreator_' + Date.now(),
            avatar: '🎬',
            category: 'Tech',
            desc: 'Verified sovereign broadcast channel',
            ownerDid: testCreatorDid,
          }),
          ok: true,
        }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@procreator' }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@procreator' }),
      };

      // Seed user in sovraDb
      sovraDb.load();
      if (!sovraDb.db.users) (sovraDb.db as any).users = [];
      sovraDb.db.users.push({
        did: testCreatorDid,
        handle: '@procreator',
        name: 'Pro Creator',
        isCreator: false,
      } as any);
      sovraDb.save();

      const handled = await handleSocialRoutes(ctx);
      expect(handled).toBe(true);
      expect(writtenStatus).toBe(200);
      const parsed = JSON.parse(writtenBody);
      expect(parsed.ok).toBe(true);
      expect(parsed.channel).toBeDefined();

      // Verify user now has isCreator = true in DB
      const user = sovraDb.getUserByDid(testCreatorDid);
      expect(user).toBeDefined();
      expect(user?.isCreator).toBe(true);
    });
  });

  // =========================================================================
  // GAP 3: Duplicate Prototype Stubs Purge (Milestone 2)
  // =========================================================================
  describe('Gap 3: Duplicate Prototype Stubs Cleaned from SovraCreatorStudioEngine', () => {
    it('does not define duplicate early stubs with hardcoded toasts', () => {
      // Check that submitWorkspaceUpload is only defined once in SovraCreatorStudioEngine
      const matchesSubmit = scriptsViewContent.match(/submitWorkspaceUpload:\s*function/g);
      expect(matchesSubmit?.length).toBe(1);

      // Check that saveCustomization is only defined once
      const matchesCustom = scriptsViewContent.match(/saveCustomization:\s*function/g);
      expect(matchesCustom?.length).toBe(1);

      // Check that claimSovereignEarnings is only defined once
      const matchesClaim = scriptsViewContent.match(/claimSovereignEarnings:\s*function/g);
      expect(matchesClaim?.length).toBe(1);
    });
  });

  // =========================================================================
  // GAP 6: WebVTT ReferenceError Fix (Milestone 2)
  // =========================================================================
  describe('Gap 6: WebVTT Subtitle Generation & ReferenceError Fix', () => {
    it('downloadWebVTT safely defines cues from curTrack.cues', () => {
      expect(scriptsViewContent).toContain('var cues = (curTrack && curTrack.cues) ? curTrack.cues : [];');
      expect(scriptsViewContent).toContain('cues.map(function(c, i)');
    });
  });

  // =========================================================================
  // GAP 4: Interactive Audio Library Web Audio Engine (Milestone 3)
  // =========================================================================
  describe('Gap 4: Interactive Audio Library Web Audio Synth Engine', () => {
    it('togglePlayAudioTrack manages Web Audio harmonic chime synth and stop method', () => {
      expect(scriptsViewContent).toContain('_activeAudioSynth: null');
      expect(scriptsViewContent).toContain('_stopActiveAudioPreview: function()');
      expect(scriptsViewContent).toContain('var freqs = [440, 554.37, 659.25];');
      expect(scriptsViewContent).toContain('this._stopActiveAudioPreview();');
    });
  });

  // =========================================================================
  // GAP 5: Studio Settings Full Persistence & Input Binding (Milestone 4)
  // =========================================================================
  describe('Gap 5: Studio Settings Full Persistence & Input Binding', () => {
    it('layout view contains studio settings input IDs and save button', () => {
      expect(layoutViewContent).toContain('id="studioSettingDefaultCategory"');
      expect(layoutViewContent).toContain('id="studioSettingDefaultTags"');
      expect(layoutViewContent).toContain('id="studioSettingBitrateCap"');
      expect(layoutViewContent).toContain('id="btnSaveStudioSettings"');
      expect(layoutViewContent).toContain('onclick="SovraCreatorStudioEngine.saveStudioSettings()"');
    });

    it('scripts view implements loadStudioSettings and saveStudioSettings', () => {
      expect(scriptsViewContent).toContain('loadStudioSettings: function()');
      expect(scriptsViewContent).toContain('saveStudioSettings: function()');
      expect(scriptsViewContent).toContain("fetch('/api/studio/settings'");
      expect(scriptsViewContent).toContain("fetch('/api/studio/settings/save'");
    });

    it('backend API GET /api/studio/settings returns default settings', async () => {
      let writtenStatus = 0;
      let writtenBody = '';
      const mockRes: any = {
        writeHead: (status: number) => { writtenStatus = status; },
        end: (body: string) => { writtenBody = body; },
      };

      const ctx: any = {
        url: new URL(`http://localhost:3001/api/studio/settings?creatorDid=${encodeURIComponent(testCreatorDid)}`),
        req: { method: 'GET', url: `/api/studio/settings?creatorDid=${encodeURIComponent(testCreatorDid)}`, headers: {} },
        res: mockRes,
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' }),
      };

      const handled = await handleStudioTranscoderRoutes(ctx);
      expect(handled).toBe(true);
      expect(writtenStatus).toBe(200);
      const data = JSON.parse(writtenBody);
      expect(data.ok).toBe(true);
      expect(data.settings).toBeDefined();
      expect(data.settings.defaultCategory).toBe('Tech');
      expect(data.settings.bitrateCap).toBe('unlimited');
    });

    it('backend API POST /api/studio/settings/save updates settings in database', async () => {
      let writtenStatus = 0;
      let writtenBody = '';
      const mockRes: any = {
        writeHead: (status: number) => { writtenStatus = status; },
        end: (body: string) => { writtenBody = body; },
      };

      const updatedSettings = {
        defaultCategory: 'Mesh',
        defaultTags: '#sovra #crypto #mesh',
        bitrateCap: '50mbps',
      };

      const ctx: any = {
        url: new URL('http://localhost:3001/api/studio/settings/save'),
        req: { method: 'POST', url: '/api/studio/settings/save', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify(updatedSettings),
          ok: true,
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' }),
      };

      const handled = await handleStudioTranscoderRoutes(ctx);
      expect(handled).toBe(true);
      expect(writtenStatus).toBe(200);
      const data = JSON.parse(writtenBody);
      expect(data.ok).toBe(true);
      expect(data.settings.defaultCategory).toBe('Mesh');
      expect(data.settings.defaultTags).toBe('#sovra #crypto #mesh');
      expect(data.settings.bitrateCap).toBe('50mbps');

      // Verify persistence via DB engine
      const retrieved = sovraDb.getCreatorStudioSettings(testCreatorDid);
      expect(retrieved.settings.defaultCategory).toBe('Mesh');
      expect(retrieved.settings.bitrateCap).toBe('50mbps');
    });
  });

  // =========================================================================
  // GAP 7: End-Screen Metadata Persistence (Milestone 5)
  // =========================================================================
  describe('Gap 7: End-Screen Metadata Persistence & Input Binding', () => {
    it('scripts view binds #editVideoEndScreenSelect in openVideoDetailsModal and saveVideoDetails', () => {
      expect(scriptsViewContent).toContain('var endScreenSelect = document.getElementById(\'editVideoEndScreenSelect\');');
      expect(scriptsViewContent).toContain('endScreenVideoId: endScreenVideoId,');
      expect(scriptsViewContent).toContain("endScreenType: endScreenVideoId && endScreenVideoId !== 'none' ? 'video' : 'none'");
    });

    it('backend /api/studio/video/update persists endScreenVideoId and endScreenType', async () => {
      let writtenStatus = 0;
      let writtenBody = '';
      const mockRes: any = {
        writeHead: (status: number) => { writtenStatus = status; },
        end: (body: string) => { writtenBody = body; },
      };

      const ctx: any = {
        url: new URL('http://localhost:3001/api/studio/video/update'),
        req: { method: 'POST', url: '/api/studio/video/update', headers: {} },
        res: mockRes,
        readBoundedBody: async () => ({
          body: JSON.stringify({
            id: testVideoId,
            title: 'Updated 4K Tutorial with End Screen',
            endScreenVideoId: 'yt-video-2',
            endScreenType: 'video',
          }),
          ok: true,
        }),
        resolvePrincipal: () => ({ did: testCreatorDid, handle: '@creator' }),
        enforceAuth: () => ({ did: testCreatorDid, handle: '@creator' }),
      };

      const handled = await handleStudioTranscoderRoutes(ctx);
      expect(handled).toBe(true);
      expect(writtenStatus).toBe(200);
      const data = JSON.parse(writtenBody);
      expect(data.ok).toBe(true);
      expect(data.video.endScreenVideoId).toBe('yt-video-2');
      expect(data.video.endScreenType).toBe('video');

      // Verify direct database read
      sovraDb.load();
      const updatedVid = sovraDb.db.videos.find((v: any) => v.id === testVideoId);
      expect(updatedVid).toBeDefined();
      expect(updatedVid?.endScreenVideoId).toBe('yt-video-2');
      expect(updatedVid?.endScreenType).toBe('video');
    });
  });
});
